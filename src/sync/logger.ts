import { App, arrayBufferToBase64 } from 'obsidian';

export interface LogEntry {
    time: number;
    action: 'Upload' | 'Download' | 'Delete Local' | 'Delete Remote' | 'Conflict' | 'Error';
    file: string;
    details?: string;
}

export class SyncLogger {
    private logPath: string;
    private maxLogs = 1000;
    private buffer: LogEntry[] = []; // 内存中做一点缓存，防止一次同步中频繁读写 IO

    constructor(private app: App, pluginDir: string) {
        this.logPath = `${pluginDir}/sync_history.json`.replace(/\/\//g, '/');
    }

    async addLog(entry: Omit<LogEntry, 'time'>) {
        this.buffer.push({ ...entry, time: Date.now() });
    }

    /**
     * 将 buffer 中的日志真正写入本地磁盘
     */
    async flush() {
        if (this.buffer.length === 0) return;

        let logs = await this.getLogs();
        // 将新日志加到开头
        logs = [...this.buffer.reverse(), ...logs];
        if (logs.length > this.maxLogs) {
            logs = logs.slice(0, this.maxLogs);
        }
        await this.app.vault.adapter.write(this.logPath, JSON.stringify(logs, null, 2));
        this.buffer = []; // 清空缓存
    }

    async getLogs(): Promise<LogEntry[]> {
        if (await this.app.vault.adapter.exists(this.logPath)) {
            try {
                const content = await this.app.vault.adapter.read(this.logPath);
                return JSON.parse(content) || [];
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    async getLogContentBase64(): Promise<string | null> {
        if (await this.app.vault.adapter.exists(this.logPath)) {
            const buffer = await this.app.vault.adapter.readBinary(this.logPath);
            return arrayBufferToBase64(buffer);
        }
        return null;
    }
}
