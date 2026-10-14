import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const bundle = await build({
    stdin: { contents: `
        export { computeSyncPlan } from './src/sync/differ';
        export { DeletionTracker } from './src/sync/deletions';
        export { SyncState } from './src/sync/state';
        export { ManifestManager, SyncLockedError } from './src/sync/manifest';
    `, resolveDir: process.cwd() },
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'obsidian-double', setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const getLanguage = () => 'en';` }));
    } }]
});
const { computeSyncPlan, DeletionTracker, SyncState, ManifestManager, SyncLockedError } =
    await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.crypto ??= webcrypto;

const baseHash = 'a'.repeat(64), editHash = 'b'.repeat(64), remoteHash = 'c'.repeat(64);
const path = 'folder/note.md';
const snapshot = { localMtime: 1, localHash: baseHash, syncedRev: 4, syncedHash: baseHash };
const remote = (hash = baseHash, rev = 5) => ({ rev, hash, size: 10, updatedBy: 'other', updatedAt: 2 });
const plan = (local, entry, confirmed = false) => computeSyncPlan(
    new Map(local ? [[path, local]] : []), new Map([[path, snapshot]]), new Map([[path, entry]]),
    new Set(confirmed ? [path] : [])
);

test('same-content remote revision does not conflict with a local offline edit', () => {
    const result = plan({ hash: editHash, mtime: 1 }, remote());
    assert.deepEqual([...result.uploads], [path]);
    assert.equal(result.conflicts.size, 0);
    assert.equal(result.downloads.size, 0);
});

test('same-content remote revision does not undo an observed local deletion', () => {
    const result = plan(undefined, remote(), true);
    assert.deepEqual([...result.deletionsRemote], [path]);
    assert.equal(result.downloads.size, 0);
});

test('same-content remote revision only advances the common snapshot', () => {
    const result = plan({ hash: baseHash, mtime: 1 }, remote());
    assert.equal(result.downloads.size, 0);
    assert.equal(result.uploads.size, 0);
    assert.equal(result.snapshotUpdates.get(path).syncedRev, 5);
});

test('matching remote and local edits advance snapshot without transferring again', () => {
    const result = plan({ hash: editHash, mtime: 1 }, remote(editHash));
    assert.equal(result.conflicts.size, 0);
    assert.equal(result.snapshotUpdates.get(path).localHash, editHash);
    assert.equal(result.snapshotUpdates.get(path).syncedHash, editHash);
});

test('actual remote content changes still preserve concurrent edit and deletion conflicts', () => {
    assert.deepEqual([...plan({ hash: editHash, mtime: 1 }, remote(remoteHash)).conflicts], [path]);
    assert.deepEqual([...plan(undefined, remote(remoteHash), true).downloads], [path]);
});

test('remote content changed back to the common base permits local edit', () => {
    // A peer publishes B and later reverts to A while this device edits A offline.
    const result = plan({ hash: editHash, mtime: 1 }, remote(baseHash, 6));
    assert.deepEqual([...result.uploads], [path]);
    assert.equal(result.conflicts.size, 0);
});

function localStorageApp(storage = new Map()) {
    return {
        storage,
        loadLocalStorage: key => storage.get(key) ?? null,
        saveLocalStorage: (key, value) => storage.set(key, structuredClone(value))
    };
}

test('observed deletion survives reload on its original device and vault', () => {
    const app = localStorageApp();
    const before = new DeletionTracker(app, 'NAS A');
    before.observe([path]); before.deleted(path);
    const after = new DeletionTracker(app, 'NAS A');
    assert.deepEqual([...after.pending], [path]);
    const result = computeSyncPlan(new Map(), new Map([[path, snapshot]]), new Map([[path, remote()]]), after.pending);
    assert.deepEqual([...result.deletionsRemote], [path]);
    after.complete(path);
    assert.equal(new DeletionTracker(app, 'NAS A').pending.size, 0);
});

test('copied snapshots and different targets cannot reuse another device deletion intent', () => {
    const originalApp = localStorageApp();
    const original = new DeletionTracker(originalApp, 'NAS A');
    original.observe([path]); original.deleted(path);
    for (const tracker of [new DeletionTracker(localStorageApp(), 'NAS A'), new DeletionTracker(originalApp, 'NAS B')]) {
        const result = computeSyncPlan(new Map(), new Map([[path, snapshot]]), new Map([[path, remote()]]), tracker.pending);
        assert.equal(result.deletionsRemote.size, 0);
        assert.deepEqual([...result.downloads], [path]);
    }
});

test('restoring a file cancels its persisted deletion intent', () => {
    const app = localStorageApp(), tracker = new DeletionTracker(app, 'NAS');
    tracker.observe([path]); tracker.deleted(path); tracker.observe([path]);
    assert.equal(tracker.pending.size, 0);
    assert.equal(new DeletionTracker(app, 'NAS').pending.size, 0);
});

test('folder deletion records only observed descendants and validates saved paths', () => {
    const app = localStorageApp(), tracker = new DeletionTracker(app, 'NAS');
    tracker.observe([path, 'folder2/other.md']); tracker.deleted('folder');
    assert.deepEqual([...tracker.pending], [path]);
    app.saveLocalStorage('synology-sync:deletions:NAS', { schemaVersion: 1, pending: [path, '../outside.md', '.obsidian/data.json', 3] });
    assert.deepEqual([...new DeletionTracker(app, 'NAS').pending], [path]);
});

function stateApp() {
    const files = new Map();
    return { files, vault: { adapter: {
        exists: async path => files.has(path),
        read: async path => files.get(path),
        write: async (path, value) => { files.set(path, value); }
    } } };
}

test('torn primary state write recovers complete snapshot from independent copy', async () => {
    const app = stateApp(), state = new SyncState(app, 'plugin', 'NAS');
    state.updateFileState(path, snapshot); await state.save();
    app.files.set('plugin/sync_data.json', '{"schemaVersion":2,');
    const recovered = new SyncState(app, 'plugin', 'NAS'); await recovered.load();
    assert.deepEqual(recovered.getFileState(path), snapshot);
});

test('missing primary after first-save interruption recovers backup', async () => {
    const app = stateApp(), state = new SyncState(app, 'plugin', 'NAS');
    state.updateFileState(path, snapshot); await state.save();
    app.files.delete('plugin/sync_data.json');
    const recovered = new SyncState(app, 'plugin', 'NAS'); await recovered.load();
    assert.deepEqual(recovered.getFileState(path), snapshot);
});

test('state with no valid copy fails closed and a foreign copy cannot authorize deletion', async () => {
    const app = stateApp(); app.files.set('plugin/sync_data.json', '{'); app.files.set('plugin/sync_data.json.bak', '{');
    await assert.rejects(new SyncState(app, 'plugin', 'NAS').load());
    const foreign = new SyncState(app, 'plugin', 'other NAS'); foreign.updateFileState(path, snapshot); await foreign.save();
    app.files.set('plugin/sync_data.json', '{');
    const recovered = new SyncState(app, 'plugin', 'NAS'); await recovered.load();
    assert.deepEqual(recovered.getAllPaths(), []);
});

test('exclusive create conflict reports a held lock without retrying or mutating it', async () => {
    let creates = 0;
    const manager = new ManifestManager({
        ensureRemoteFolder: async () => {},
        createFolder: async () => { creates++; throw Error('API Error'); },
        listFiles: async () => ({ success: true, data: { total: 1, items: [{ name: '.sync_lock', type: 'dir' }] } })
    }, '/mydrive/notes');
    await assert.rejects(manager.acquireLock('device'), SyncLockedError);
    assert.equal(creates, 1);
});
