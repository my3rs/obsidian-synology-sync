import type { App } from 'obsidian';
import { record, validPath } from './validation';

/** Durable candidate paths, never deletion authority. File bytes remain in the vault. */
export class SyncQueue {
    private entries = new Map<string, string>();
    private key: string;

    constructor(private app?: Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>, target = '') {
        this.key = `synology-sync:queue:${target}`;
        const saved: unknown = app?.loadLocalStorage?.(this.key);
        if (!record(saved) || saved.schemaVersion !== 1 || !Array.isArray(saved.entries)) return;
        for (const entry of saved.entries) {
            if (Array.isArray(entry) && typeof entry[0] === 'string' && validPath(entry[0])
                && typeof entry[1] === 'string') this.entries.set(entry[0], entry[1]);
        }
    }

    mark(paths: Iterable<string>): void {
        let changed = false;
        for (const path of paths) {
            if (!validPath(path)) continue;
            this.entries.set(path, crypto.randomUUID());
            changed = true;
        }
        if (changed) this.save();
    }

    snapshot(): ReadonlyMap<string, string> { return new Map(this.entries); }

    complete(batch: ReadonlyMap<string, string>): void {
        const next = new Map(this.entries);
        for (const [path, token] of batch) {
            // Edits made during this operation belong to the next batch.
            if (next.get(path) === token) next.delete(path);
        }
        if (next.size === this.entries.size) return;
        // A failed persistence must leave the in-memory queue pending too.
        this.save(next);
        this.entries = next;
    }

    private save(entries = this.entries): void {
        this.app?.saveLocalStorage?.(this.key, { schemaVersion: 1, entries: [...entries] });
    }
}
