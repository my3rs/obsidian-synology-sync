import { App } from 'obsidian';

export interface LocalFileEntry {
    localMtime: number;    // 上次同步时的本地 mtime
    localHash: string;     // 上次同步时的本地 SHA-256
    syncedRev: number;     // 上次同步时对应的清单 rev
    syncedHash: string;    // 上次同步时对应的清单 hash
}

export interface LocalSyncData {
    schemaVersion: 1;
    deviceId: string;
    files: Record<string, LocalFileEntry>;
}

// 兼容旧版的数据结构
interface OldFileSyncState {
    local_mtime: number;
    local_hash: string;
    remote_hash: string;
}
interface OldSyncDataRoot {
    lastSyncTime?: number;
    files?: Record<string, OldFileSyncState>;
}

export class SyncState {
    private app: App;
    private data: LocalSyncData = { schemaVersion: 1, deviceId: '', files: {} };
    private path: string;

    constructor(app: App, pluginDir: string) {
        this.app = app;
        this.path = `${pluginDir}/sync_data.json`.replace(/\/\//g, '/');
    }

    private generateDeviceId(): string {
        return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    }

    async load() {
        try {
            if (await this.app.vault.adapter.exists(this.path)) {
                const content = await this.app.vault.adapter.read(this.path);
                const parsed = JSON.parse(content) as unknown;
                
                if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed && parsed.schemaVersion === 1) {
                    this.data = parsed as LocalSyncData;
                    if (!this.data.deviceId) {
                        this.data.deviceId = this.generateDeviceId();
                    }
                } else {
                    // 迁移旧版数据
                    console.debug("[SynologySync] Migrating old sync state...");
                    const oldData = parsed as Partial<OldSyncDataRoot> | Record<string, OldFileSyncState>;
                    const oldFiles = (parsed && typeof parsed === 'object' && 'lastSyncTime' in (parsed as Record<string, unknown>)) 
                        ? (oldData as OldSyncDataRoot).files || {} 
                        : (oldData as Record<string, OldFileSyncState>) || {};
                    
                    const newFiles: Record<string, LocalFileEntry> = {};
                    for (const [path, state] of Object.entries(oldFiles)) {
                        newFiles[path] = {
                            localMtime: state.local_mtime,
                            localHash: state.local_hash,
                            syncedRev: 0, // 设为 0，强制触发与新版 manifest 的 hash 比较
                            syncedHash: state.local_hash, // 乐观认为本地 hash 即远端 hash
                        };
                    }
                    
                    this.data = {
                        schemaVersion: 1,
                        deviceId: this.generateDeviceId(),
                        files: newFiles
                    };
                    await this.save(); // 立即保存迁移后的数据
                }
            } else {
                this.data.deviceId = this.generateDeviceId();
            }
        } catch (e: unknown) {
            console.error("Failed to load sync state, creating new one.", e);
            this.data = { schemaVersion: 1, deviceId: this.generateDeviceId(), files: {} };
        }
    }

    async save() {
        try {
            await this.app.vault.adapter.write(this.path, JSON.stringify(this.data));
        } catch (e: unknown) {
            console.error("Failed to save sync state", e);
        }
    }

    getFileState(path: string): LocalFileEntry | undefined {
        return this.data.files[path];
    }

    updateFileState(path: string, state: LocalFileEntry) {
        this.data.files[path] = state;
    }

    removeFileState(path: string) {
        delete this.data.files[path];
    }
    
    getAllPaths(): string[] {
        return Object.keys(this.data.files);
    }

    clear() {
        const currentDeviceId = this.data.deviceId || this.generateDeviceId();
        this.data = { schemaVersion: 1, deviceId: currentDeviceId, files: {} };
    }

    getDeviceId(): string {
        return this.data.deviceId;
    }
}
