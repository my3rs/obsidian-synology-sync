import { Notice, TAbstractFile } from 'obsidian';
import type SynologySyncPlugin from '../main';
import type { SynologySyncSettings } from '../settings';
import type { SyncEngine } from './engine';
import { DeletionTracker } from './deletions';
import { syncTarget } from './remote-access';
import { isSyncablePath, isSyncWrite } from '../fs/local';
import { t } from '../locales';
import { SyncLockedError } from './manifest';
import { SyncQueue } from './queue';

export type SyncUIState = 'idle' | 'pending' | 'waiting-network' | 'waiting-lock' | 'syncing' | 'force-uploading' | 'force-downloading' | 'rebuilding' | 'error';

/** Serialize all entry points and retain user changes that arrive during a sync. */
export class SyncController {
    deletions = new DeletionTracker();
    private queue = new SyncQueue();
    private target = '';
    private credentials = '';
    private session = '';
    private ready = false;
    private unloaded = false;
    private active: AbortController | null = null;
    private timeout: number | null = null;
    private pending = false;
    private pendingFull = false;
    private notice: Notice | null = null;
    private noticeTimeout: number | null = null;
    private offline = false;
    private lockRetries = 0;

    constructor(private plugin: SynologySyncPlugin) {}

    initialize(): void {
        this.credentials = this.credentialKey(this.plugin.settings);
        this.session = this.plugin.settings.sid;
        this.resetTarget();
    }

    layoutReady(): void {
        if (this.unloaded) return;
        this.ready = true;
        this.observeFiles();
        void this.runSync(true);
    }

    /** Browser connectivity is only a hint; manual sync can still try the NAS. */
    resume(online = true): void {
        if (this.unloaded) return;
        this.offline = !online;
        if (!this.ready) return;
        if (this.offline) { this.networkOffline(); return; }
        void this.runSync(false);
    }

    networkOffline(): void {
        if (this.unloaded) return;
        this.offline = true;
        this.clearTimer();
        if (this.ready && !this.active) this.showStatus('waiting-network');
    }

    get pendingCount(): number {
        return new Set([...this.queue.snapshot().keys(), ...this.deletions.pending]).size;
    }

    settingsChanged(): void {
        const settings = this.plugin.settings;
        const credentials = this.credentialKey(settings);
        if (credentials !== this.credentials) {
            // A session belongs to its authenticated NAS and account, never a new address.
            settings.sid = '';
            this.credentials = credentials;
        }
        const target = syncTarget(settings.nasUrl, settings.username, settings.syncFolder);
        if (target !== this.target || settings.sid !== this.session) {
            this.active?.abort();
            this.clearTimer();
            this.pending = false;
            this.pendingFull = false;
            this.lockRetries = 0;
            if (target !== this.target) {
                settings.lastSyncTime = undefined;
                this.resetTarget();
            }
            this.session = settings.sid;
            if (this.ready && !this.active) this.showRestingStatus();
        }
    }

    fileChanged(file?: TAbstractFile, deletedPath?: string): void {
        if (!this.ready || this.unloaded) return;
        const removed = deletedPath && isSyncablePath(this.plugin.app, deletedPath) && !isSyncWrite(this.plugin.app, deletedPath);
        const changed = file && isSyncablePath(this.plugin.app, file.path) && !isSyncWrite(this.plugin.app, file.path);
        if (!removed && !changed) return;
        this.pending = true;
        try {
            if (removed) this.deletions.deleted(deletedPath);
            const paths = new Set<string>();
            if (removed) {
                paths.add(deletedPath);
                for (const path of this.deletions.pending) paths.add(path);
            }
            if (changed) {
                // Observe only real files: a folder itself must never authorize deletion.
                const descendants = this.plugin.app.vault.getFiles().map(value => value.path)
                    .filter(path => (path === file.path || path.startsWith(file.path + '/')) && isSyncablePath(this.plugin.app, path));
                this.deletions.observe(descendants);
                paths.add(file.path);
                for (const path of descendants) paths.add(path);
            }
            this.queue.mark(paths);
        } catch (error) {
            this.showStatus('error');
            new Notice(t('notice.queueSaveFailed', { error: error instanceof Error ? error.message : String(error) }));
            if (!this.active) this.schedule();
            return;
        }
        if (!this.active) this.showRestingStatus();
        if (!this.active) this.schedule();
    }

    async runSync(fullScan: boolean, showNotice = false): Promise<void> {
        if (this.active) {
            this.pending = true;
            this.pendingFull ||= fullScan;
            if (showNotice) new Notice(t('notice.engine.syncing'));
            return;
        }
        const full = fullScan || this.pendingFull;
        await this.run('syncing', engine => engine.runSync(full), showNotice, undefined, undefined, { fullScan: full, acknowledge: true });
    }

    async forceUpload(): Promise<void> {
        await this.run('force-uploading', engine => engine.forceUpload(), true, 'notice.forceUploadSuccess', 'notice.forceUploadFailed');
    }

    async forceDownload(): Promise<void> {
        await this.run('force-downloading', engine => engine.forceDownload(), true, 'notice.forceDownloadSuccess', 'notice.forceDownloadFailed');
    }

    async rebuild(): Promise<void> {
        await this.run('rebuilding', engine => engine.rebuildSyncState(), true, 'notice.rebuildSuccess', 'notice.rebuildFailed', { acknowledge: true });
    }

    async recoverLock(): Promise<void> {
        await this.run('rebuilding', async engine => {
            await engine.recoverLock();
            return engine.runSync(true);
        }, true, 'notice.recoverLockSuccess', 'notice.recoverLockFailed', { acknowledge: true });
    }

    async transferActiveFile(direction: 'upload' | 'download'): Promise<void> {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file) { new Notice(t('notice.noActiveFile')); return; }
        await this.run('syncing', engine => engine.syncFile(file.path, direction), true, undefined, undefined, { onlyPath: file.path, acknowledge: direction === 'upload' });
    }

    dispose(): void {
        this.unloaded = true;
        this.ready = false;
        this.active?.abort();
        this.clearTimer();
        this.hideNotice();
    }

    private async run(state: SyncUIState, operation: (engine: SyncEngine) => Promise<boolean>, showNotice: boolean,
        successKey: Parameters<typeof t>[0] = 'notice.engine.syncSuccess',
        failureKey: Parameters<typeof t>[0] = 'notice.syncException',
        options: { onlyPath?: string; fullScan?: boolean; acknowledge?: boolean } = {}): Promise<void> {
        const fullScan = options.fullScan ?? true;
        if (!this.ready || this.unloaded) return;
        if (this.active) { if (showNotice) new Notice(t('notice.engine.syncing')); return; }
        if (!this.configured()) { if (showNotice) new Notice(t('notice.nasParamsMissing')); return; }
        if (this.offline && !showNotice) {
            this.pendingFull ||= fullScan;
            this.showStatus('waiting-network');
            return;
        }
        const controller = new AbortController();
        const queue = this.queue;
        const batch = new Map([...queue.snapshot()].filter(([path]) => options.acknowledge && (!options.onlyPath || path === options.onlyPath)));
        this.active = controller;
        this.pending = false;
        this.pendingFull = false;
        this.clearTimer();
        this.hideNotice();
        this.showStatus(state);
        if (showNotice) this.notice = new Notice(t('notice.engine.syncing'), 0);
        try {
            const engine = await this.plugin.getEngine(controller.signal);
            if (controller.signal.aborted) return;
            const changed = await operation(engine);
            if (controller.signal.aborted) return;
            // A successful verification is a completed sync even when neither side changed.
            this.plugin.settings.lastSyncTime = Date.now();
            await this.plugin.saveSettings();
            if (controller.signal.aborted) return;
            queue.complete(batch);
            this.lockRetries = 0;
            this.showRestingStatus();
            this.notice?.setMessage(this.pendingCount || this.pending
                ? this.pendingCount ? t('status.pending', { count: String(this.pendingCount) }) : t('status.checkPending')
                : t(changed || successKey !== 'notice.engine.syncSuccess' ? successKey : 'notice.engine.syncUpToDate'));
            if (this.notice) this.noticeTimeout = window.setTimeout(() => this.hideNotice(), 3000);
            this.plugin.app.workspace.trigger('synology-sync:sync-completed');
        } catch (error) {
            if (!controller.signal.aborted) {
                this.pendingFull ||= fullScan;
                if (error instanceof SyncLockedError) {
                    this.pending = true;
                    this.lockRetries++;
                    this.showStatus('waiting-lock');
                    this.hideNotice();
                    return;
                }
                console.error('[SynologySync] Sync error', error);
                this.showStatus('error');
                this.hideNotice();
                new Notice(t(failureKey, { error: error instanceof Error ? error.message : String(error) }));
            }
        } finally {
            this.active = null;
            if (controller.signal.aborted) {
                this.hideNotice();
                if (!this.unloaded) this.showRestingStatus();
            }
            if (this.pending && !this.unloaded) this.schedule(Math.min(3000 * 2 ** Math.min(this.lockRetries, 4), 30000));
        }
    }

    private schedule(delay = 3000): void {
        this.clearTimer();
        if (!this.configured() || this.offline || this.unloaded) return;
        this.timeout = window.setTimeout(() => {
            this.timeout = null;
            void this.runSync(this.pendingFull);
        }, delay);
    }

    private configured(): boolean {
        const { nasUrl, username, sid, syncFolder } = this.plugin.settings;
        return !!(nasUrl.trim() && username.trim() && sid && syncFolder.trim());
    }

    private resetTarget(): void {
        const { nasUrl, username, syncFolder } = this.plugin.settings;
        this.target = syncTarget(nasUrl, username, syncFolder);
        this.deletions = new DeletionTracker(this.plugin.app, this.target);
        this.queue = new SyncQueue(this.plugin.app, this.target);
        if (this.ready) this.observeFiles();
    }

    private observeFiles(): void {
        this.deletions.observe(this.plugin.app.vault.getFiles().map(file => file.path).filter(path => isSyncablePath(this.plugin.app, path)));
    }

    private credentialKey(settings: SynologySyncSettings): string {
        return JSON.stringify([settings.nasUrl, settings.username, settings.password]);
    }

    private showStatus(state: SyncUIState): void {
        this.plugin.updateStatusBar(state, this.pendingCount);
    }

    private showRestingStatus(): void {
        this.showStatus(this.offline ? 'waiting-network' : this.pendingCount || this.pending ? 'pending' : 'idle');
    }

    private clearTimer(): void {
        if (this.timeout !== null) window.clearTimeout(this.timeout);
        this.timeout = null;
    }

    private hideNotice(): void {
        if (this.noticeTimeout !== null) window.clearTimeout(this.noticeTimeout);
        this.noticeTimeout = null;
        this.notice?.hide();
        this.notice = null;
    }
}
