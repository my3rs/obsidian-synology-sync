import type { App } from 'obsidian';
import { record, validPath } from './validation';

/** Observed deletions stay on this device and vault, never in a portable snapshot. */
export class DeletionTracker {
    private seen = new Set<string>();
    readonly pending = new Set<string>();

    constructor(private app?: Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>, private namespace = '') {
        // Older test adapters can operate in memory; supported Obsidian versions
        // provide vault-scoped localStorage that is not copied with plugin files.
        const saved: unknown = this.app?.loadLocalStorage?.(this.key());
        if (!record(saved) || saved.schemaVersion !== 1 || !Array.isArray(saved.pending)) return;
        for (const path of saved.pending) {
            if (typeof path === 'string' && validPath(path)) this.pending.add(path);
        }
    }

    private key() { return `synology-sync:deletions:${this.namespace}`; }
    private save() {
        this.app?.saveLocalStorage?.(this.key(), { schemaVersion: 1, pending: [...this.pending] });
    }

    observe(paths: Iterable<string>) {
        let changed = false;
        for (const path of paths) {
            if (!validPath(path)) continue;
            this.seen.add(path);
            if (this.pending.delete(path)) changed = true;
        }
        if (changed) this.save();
    }
    deleted(path: string) {
        let changed = false;
        for (const seen of this.seen) {
            if ((seen === path || seen.startsWith(path + '/')) && !this.pending.has(seen)) {
                this.pending.add(seen);
                changed = true;
            }
        }
        if (changed) this.save();
    }
    complete(path: string) {
        const changed = this.pending.delete(path);
        this.seen.delete(path);
        if (changed) this.save();
    }
}
