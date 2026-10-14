import { App } from 'obsidian';
import { t } from '../locales';
import { isHash, record, validPath } from './validation';

export interface LocalFileEntry {
    localMtime: number;
    localHash: string;
    syncedRev: number;
    syncedHash: string;
}

export interface LocalSyncData {
    schemaVersion: 2;
    deviceId: string;
    target: string;
    files: Record<string, LocalFileEntry>;
}

export class SyncState {
    private data: LocalSyncData;
    private path: string;

    constructor(private app: App, pluginDir: string, private target = '') {
        this.path = `${pluginDir}/sync_data.json`.replace(/\/\//g, '/');
        this.data = this.empty();
    }

    private empty(): LocalSyncData {
        return { schemaVersion: 2, deviceId: crypto.randomUUID(), target: this.target, files: {} };
    }

    async load() {
        this.data = this.empty();
        let failure: Error | undefined;
        for (const path of [this.path, `${this.path}.bak`]) {
            if (!await this.app.vault.adapter.exists(path)) continue;
            try {
                const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(path));
                this.data = this.parse(parsed) ?? this.data;
                return;
            } catch (error) { failure ??= error instanceof Error ? error : new Error(String(error)); }
        }
        // A truncated write may be recovered from the independently persisted copy.
        // Invalid copies must never become a new empty authoritative snapshot.
        if (failure) throw failure;
    }

    private parse(parsed: unknown): LocalSyncData | null {
        if (!record(parsed)) throw new Error(t('safety.invalidManifest'));
        // Legacy and foreign target snapshots cannot authorize a deletion.
        if (parsed.schemaVersion === 1 || parsed.schemaVersion === undefined) return null;
        if (parsed.schemaVersion !== 2) throw new Error(t('safety.invalidManifest'));
        if (parsed.target !== this.target) return null;
        if (!record(parsed.files) || typeof parsed.deviceId !== 'string') throw new Error(t('safety.invalidManifest'));
        for (const [path, value] of Object.entries(parsed.files)) {
            if (!validPath(path) || !record(value) || !isHash(value.localHash) || !isHash(value.syncedHash)
                || !Number.isSafeInteger(value.syncedRev) || Number(value.syncedRev) < 1
                || typeof value.localMtime !== 'number' || !Number.isFinite(value.localMtime)) {
                throw new Error(t('safety.invalidManifest'));
            }
        }
        return parsed as unknown as LocalSyncData;
    }

    async save() {
        // Failure must reach the caller; it must never be reported as a successful sync.
        const serialized = JSON.stringify(this.data);
        // Keep a second complete copy before replacing the primary. No assumption
        // about an adapter's rename/overwrite atomicity is needed on mobile.
        await this.app.vault.adapter.write(`${this.path}.bak`, serialized);
        await this.app.vault.adapter.write(this.path, serialized);
    }

    getFileState(path: string): LocalFileEntry | undefined { return this.data.files[path]; }
    updateFileState(path: string, state: LocalFileEntry) { this.data.files[path] = state; }
    removeFileState(path: string) { delete this.data.files[path]; }
    getAllPaths(): string[] { return Object.keys(this.data.files); }
    clear() { this.data.files = {}; }
    getDeviceId(): string { return this.data.deviceId; }
}
