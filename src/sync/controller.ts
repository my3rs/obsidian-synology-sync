import { Notice, TAbstractFile } from 'obsidian';
import type SynologySyncPlugin from '../main';
import type { SynologySyncSettings } from '../settings';
import type { SyncEngine } from './engine';
import { DeletionTracker } from './deletions';
import { syncTarget } from './remote-access';
import { isSyncablePath, isSyncWrite } from '../fs/local';
import { t } from '../locales';
import { SyncLockedError } from './manifest';

export type SyncUIState = 'idle' | 'syncing' | 'force-uploading' | 'force-downloading' | 'rebuilding' | 'error';

/** Serialize all entry points and retain user changes that arrive during a sync. */
export class SyncController {
    deletions = new DeletionTracker();
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
            if (target !== this.target) {
                settings.lastSyncTime = undefined;
                this.resetTarget();
            }
            this.session = settings.sid;
        }
    }

    fileChanged(file?: TAbstractFile, deletedPath?: string): void {
        if (!this.ready || this.unloaded) return;
        const removed = deletedPath && isSyncablePath(this.plugin.app, deletedPath) && !isSyncWrite(this.plugin.app, deletedPath);
        const changed = file && isSyncablePath(this.plugin.app, file.path) && !isSyncWrite(this.plugin.app, file.path);
        if (removed) {
            this.deletions.deleted(deletedPath);
        }
        if (!removed && !changed) return;
        if (changed) {
            // A rename creates a new observed path (or an entire subtree); a delete does not.
            this.deletions.observe(this.plugin.app.vault.getFiles().map(value => value.path)
                .filter(path => path === file.path || path.startsWith(file.path + '/')));
        }
        this.pending = true;
        if (!this.active) this.schedule();
    }

    async runSync(fullScan: boolean, showNotice = false): Promise<void> {
        if (this.active) {
            if (showNotice) {
                this.pending = true;
                this.pendingFull ||= fullScan;
                new Notice(t('notice.engine.syncing'));
            }
            return;
        }
        await this.run('syncing', engine => engine.runSync(fullScan), showNotice);
    }

    async forceUpload(): Promise<void> {
        await this.run('force-uploading', engine => engine.forceUpload(), true, 'notice.forceUploadSuccess', 'notice.forceUploadFailed');
    }

    async forceDownload(): Promise<void> {
        await this.run('force-downloading', engine => engine.forceDownload(), true, 'notice.forceDownloadSuccess', 'notice.forceDownloadFailed');
    }

    async rebuild(): Promise<void> {
        await this.run('rebuilding', engine => engine.rebuildSyncState(), true, 'notice.rebuildSuccess', 'notice.rebuildFailed');
    }

    async recoverLock(): Promise<void> {
        await this.run('rebuilding', async engine => {
            await engine.recoverLock();
            return engine.runSync(true);
        }, true, 'notice.recoverLockSuccess', 'notice.recoverLockFailed');
    }

    async transferActiveFile(direction: 'upload' | 'download'): Promise<void> {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file) { new Notice(t('notice.noActiveFile')); return; }
        await this.run('syncing', engine => engine.syncFile(file.path, direction), true);
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
        failureKey: Parameters<typeof t>[0] = 'notice.syncException'): Promise<void> {
        if (!this.ready || this.unloaded) return;
        if (this.active) { if (showNotice) new Notice(t('notice.engine.syncing')); return; }
        if (!this.configured()) { if (showNotice) new Notice(t('notice.nasParamsMissing')); return; }
        const controller = new AbortController();
        this.active = controller;
        this.pending = false;
        this.pendingFull = false;
        this.clearTimer();
        this.hideNotice();
        this.plugin.updateStatusBar(state);
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
            this.plugin.updateStatusBar('idle');
            this.notice?.setMessage(t(changed || successKey !== 'notice.engine.syncSuccess' ? successKey : 'notice.engine.syncUpToDate'));
            if (this.notice) this.noticeTimeout = window.setTimeout(() => this.hideNotice(), 3000);
            this.plugin.app.workspace.trigger('synology-sync:sync-completed');
        } catch (error) {
            if (!controller.signal.aborted) {
                if (error instanceof SyncLockedError && !showNotice) {
                    this.plugin.updateStatusBar('idle');
                    return;
                }
                console.error('[SynologySync] Sync error', error);
                this.plugin.updateStatusBar('error');
                this.hideNotice();
                new Notice(t(failureKey, { error: error instanceof Error ? error.message : String(error) }));
            }
        } finally {
            this.active = null;
            if (controller.signal.aborted) {
                this.hideNotice();
                if (!this.unloaded) this.plugin.updateStatusBar('idle');
            }
            if (this.pending && !this.unloaded) this.schedule();
        }
    }

    private schedule(): void {
        this.clearTimer();
        if (!this.configured()) return;
        this.timeout = window.setTimeout(() => {
            this.timeout = null;
            void this.runSync(this.pendingFull);
        }, 3000);
    }

    private configured(): boolean {
        const { nasUrl, username, sid, syncFolder } = this.plugin.settings;
        return !!(nasUrl.trim() && username.trim() && sid && syncFolder.trim());
    }

    private resetTarget(): void {
        const { nasUrl, username, syncFolder } = this.plugin.settings;
        this.target = syncTarget(nasUrl, username, syncFolder);
        this.deletions = new DeletionTracker(this.plugin.app, this.target);
        if (this.ready) this.observeFiles();
    }

    private observeFiles(): void {
        this.deletions.observe(this.plugin.app.vault.getFiles().map(file => file.path).filter(path => isSyncablePath(this.plugin.app, path)));
    }

    private credentialKey(settings: SynologySyncSettings): string {
        return JSON.stringify([settings.nasUrl, settings.username, settings.password]);
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
