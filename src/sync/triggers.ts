import type { Plugin } from 'obsidian';
import type { SyncController } from './controller';

/** Use the owning window/document so plugin unload removes every listener. */
export function registerSyncTriggers(plugin: Plugin, controller: SyncController): void {
    const doc = document;
    const win = window;
    const resume = () => {
        if (!doc.hidden) controller.resume(win.navigator.onLine);
    };
    plugin.registerDomEvent(doc, 'visibilitychange', resume);
    plugin.registerDomEvent(win, 'focus', resume);
    plugin.registerDomEvent(win, 'online', () => controller.resume(true));
    plugin.registerDomEvent(win, 'offline', () => controller.networkOffline());
    if (win.navigator.onLine === false) controller.networkOffline();
}
