import { App } from 'obsidian';

export interface FileSyncState {
    local_mtime: number;
    local_hash: string;
    remote_hash: string;
}

export interface SyncDataRoot {
    lastSyncTime: number;
    files: Record<string, FileSyncState>;
}

export class SyncState {
    private app: App;
    private data: SyncDataRoot = { lastSyncTime: 0, files: {} };
    private path: string;

    constructor(app: App) {
        this.app = app;
        this.path = this.app.vault.configDir + '/plugins/obsidian-synology-sync/sync_data.json';
    }

    async load() {
        try {
            if (await this.app.vault.adapter.exists(this.path)) {
                const content = await this.app.vault.adapter.read(this.path);
                const parsed = JSON.parse(content);
                // 兼容旧版本或空文件
                if (parsed && typeof parsed.lastSyncTime === 'number') {
                    this.data = parsed;
                } else {
                    this.data = { lastSyncTime: 0, files: parsed || {} };
                }
            }
        } catch (e) {
            console.error("Failed to load sync state", e);
            this.data = { lastSyncTime: 0, files: {} };
        }
    }

    async save() {
        try {
            await this.app.vault.adapter.write(this.path, JSON.stringify(this.data));
        } catch (e) {
            console.error("Failed to save sync state", e);
        }
    }

    getFileState(path: string): FileSyncState | undefined {
        return this.data.files[path];
    }

    updateFileState(path: string, state: FileSyncState) {
        this.data.files[path] = state;
    }

    removeFileState(path: string) {
        delete this.data.files[path];
    }
    
    getAllPaths(): string[] {
        return Object.keys(this.data.files);
    }

    clear() {
        this.data = { lastSyncTime: 0, files: {} };
    }

    getLastSyncTime(): number {
        return this.data.lastSyncTime;
    }

    setLastSyncTime(time: number) {
        this.data.lastSyncTime = time;
    }
}
