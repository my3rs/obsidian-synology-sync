import { SynologyClient } from '../api/client';
import { ManifestEntry, ManifestManager, SyncManifest, validateManifest } from './manifest';
import { calculateSHA256 } from './utils';
import { isHash, record, validPath } from './validation';
import { t } from '../locales';
import { readRemoteRecord } from './remote-access';
import { assertActive } from './cancellation';

/** One write-ahead remote operation at a time, replayable after any network/process failure. */
export class RemoteTransaction {
    constructor(private client: SynologyClient, private manager: ManifestManager, private folder: string, private signal?: AbortSignal) {}
    private path(name: string) { return `${this.folder}/${name}`; }

    async recover(deviceId: string): Promise<void> {
        assertActive(this.signal);
        await this.manager.assertLock();
        const buffer = await readRemoteRecord(this.client, this.path('.sync_pending.json'));
        if (buffer === null) return;
        const journal: unknown = JSON.parse(new TextDecoder().decode(buffer));
        if (!record(journal) || typeof journal.path !== 'string' || !validPath(journal.path)) throw new Error(t('safety.invalidManifest'));
        validateManifest(journal.manifest);
        const entry = journal.manifest.files[journal.path];
        if (!entry) throw new Error(t('safety.invalidManifest'));
        if (journal.schemaVersion !== undefined && journal.schemaVersion !== 2) throw new Error(t('safety.invalidManifest'));
        if (journal.schemaVersion === 2 && journal.previousHash !== null && !isHash(journal.previousHash)) throw new Error(t('safety.invalidManifest'));

        const current = await this.manager.downloadManifest();
        // A saved whole-manifest journal must never roll back a newer committed revision.
        for (const [path, value] of Object.entries(current.files)) {
            const next = journal.manifest.files[path];
            if (!next || next.rev < value.rev || (next.rev === value.rev && (next.hash !== value.hash || !!next.deleted !== !!value.deleted))) {
                throw new Error(t('safety.pendingChanged', { path }));
            }
        }
        // Older journals did not save the expected bytes. A pre-commit manifest can still
        // prove them; a committed journal needs only idempotent cleanup, never a blind replay.
        const previous = current.files[journal.path];
        const previousHash = journal.schemaVersion === 2 ? journal.previousHash
            : !previous ? null : previous.rev < entry.rev ? (previous.deleted ? null : previous.hash) : undefined;
        const content = await readRemoteRecord(this.client, this.path(journal.path));
        const currentHash = content === null ? null : await calculateSHA256(content);
        const desiredHash = entry.deleted ? null : entry.hash;
        if (currentHash !== desiredHash && currentHash !== previousHash) throw new Error(t('safety.pendingChanged', { path: journal.path }));
        assertActive(this.signal);
        await this.manager.assertLock();
        if (currentHash !== desiredHash) {
            if (entry.deleted) {
                assertActive(this.signal);
                await this.client.deleteFile(this.path(journal.path));
            } else {
                const buffer = await this.client.downloadFile(this.path('.sync_pending_data'));
                if (await calculateSHA256(buffer) !== entry.hash) throw new Error(t('safety.hashMismatch'));
                assertActive(this.signal);
                await this.manager.assertLock();
                assertActive(this.signal);
                await this.client.uploadFile(this.path(journal.path), buffer);
            }
        }
        assertActive(this.signal);
        await this.manager.uploadManifest(journal.manifest, deviceId);
        assertActive(this.signal);
        await this.manager.assertLock();
        assertActive(this.signal);
        await this.client.deleteFile(this.path('.sync_pending.json'));
    }

    async commit(path: string, manifest: SyncManifest, deviceId: string, buffer?: ArrayBuffer, previous?: ManifestEntry): Promise<void> {
        validateManifest(manifest);
        assertActive(this.signal);
        await this.manager.assertLock();
        if (await readRemoteRecord(this.client, this.path('.sync_pending.json')) !== null) throw new Error(t('safety.pending'));
        assertActive(this.signal);
        if (buffer) await this.client.uploadFile(this.path('.sync_pending_data'), buffer);
        assertActive(this.signal);
        await this.manager.assertLock();
        assertActive(this.signal);
        await this.client.uploadFile(this.path('.sync_pending.json'), new TextEncoder().encode(JSON.stringify({
            schemaVersion: 2, path, manifest, previousHash: !previous || previous.deleted ? null : previous.hash
        })).buffer);
        await this.recover(deviceId);
    }
}
