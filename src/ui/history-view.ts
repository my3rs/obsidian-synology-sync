import { ItemView, WorkspaceLeaf, Notice, TFile, setIcon } from 'obsidian';
import type SynologySyncPlugin from '../main';
import { calculateSHA256 } from '../sync/utils';
import { t } from '../locales';

export const HISTORY_VIEW_TYPE = 'synology-drive-history-view';

export class HistoryView extends ItemView {
    plugin: SynologySyncPlugin;
    currentFile: TFile | null = null;
    revisions: any[] = [];
    isLoading: boolean = false;
    private refreshIconEl!: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: SynologySyncPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return HISTORY_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t('view.history.title');
    }

    getIcon(): string {
        return 'clock'; // Built-in Lucide icon
    }

    async onOpen() {
        this.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', () => {
                this.updateCurrentFile();
            })
        );
        
        await this.updateCurrentFile();
    }

    async updateCurrentFile() {
        const file = this.plugin.app.workspace.getActiveFile();
        if (this.currentFile?.path === file?.path) {
            return;
        }
        this.currentFile = file;
        await this.loadHistory();
    }

    async loadHistory() {
        const container = this.contentEl;
        container.empty();
        this.revisions = [];

        // Header
        const header = container.createDiv('history-view-header');
        const titleArea = header.createDiv('history-title-area');
        titleArea.createEl('h4', { text: t('view.history.title') });
        
        if (this.currentFile) {
            titleArea.createEl('div', { 
                text: this.currentFile.path, 
                cls: 'history-file-path' 
            });
        }
        
        this.refreshIconEl = header.createDiv('clickable-icon history-refresh-btn');
        setIcon(this.refreshIconEl, 'refresh-cw');
        this.refreshIconEl.addEventListener('click', () => {
            this.loadHistory();
        });

        const listContainer = container.createDiv('history-list-container');

        if (!this.currentFile) {
            listContainer.createDiv({
                text: t('view.history.noActiveFile'),
                cls: 'history-empty-state'
            });
            return;
        }

        if (!this.plugin.settings.sid) {
            const el = listContainer.createDiv({ cls: 'history-empty-state' });
            el.createEl('div', { text: t('notice.loginRequired') });
            return;
        }

        this.setLoading(true);

        try {
            const engine = await (this.plugin as any).getEngine();
            const remotePath = (engine as any).toRemotePath(this.currentFile.path);

            // 1. Get file_id from metadata
            const meta = await (await (this.plugin as any).getClient()).getMetadata(remotePath);
            if (!meta?.data?.file_id) {
                listContainer.createDiv({
                    text: t('view.history.fileNotOnRemote'),
                    cls: 'history-empty-state'
                });
                return;
            }

            const fileId = meta.data.file_id;

            // 2. Fetch Revisions
            const revs = await (await (this.plugin as any).getClient()).getFileRevisions(fileId);
            this.revisions = revs || [];

            if (this.revisions.length === 0) {
                listContainer.createDiv({
                    text: t('view.history.noRevisions'),
                    cls: 'history-empty-state'
                });
                return;
            }

            // 3. Render Revisions
            for (const rev of this.revisions) {
                this.renderRevisionCard(listContainer, rev, remotePath);
            }

        } catch (e: any) {
            console.error('Failed to load history:', e);
            listContainer.createDiv({
                text: t('view.history.loadFailed') + ': ' + e.message,
                cls: 'history-error-state'
            });
        } finally {
            this.setLoading(false);
        }
    }

    private renderRevisionCard(container: HTMLElement, rev: any, remotePath: string) {
        const card = container.createDiv('history-revision-card');
        
        if (rev.is_current || rev.action === 'current') {
            card.addClass('history-revision-current');
        }

        const header = card.createDiv('history-rev-header');
        const date = new Date(rev.modified_time * 1000);
        
        header.createSpan({ 
            text: date.toLocaleString(), 
            cls: 'history-rev-date' 
        });

        const meta = card.createDiv('history-rev-meta');
        meta.createSpan({ text: rev.modifier || 'Unknown', cls: 'history-rev-author' });
        meta.createSpan({ text: this.formatSize(rev.size), cls: 'history-rev-size' });

        const actions = card.createDiv('history-rev-actions');
        
        // Restore Action
        const restoreBtn = actions.createEl('button', { text: t('view.history.btnRestore') });
        restoreBtn.addEventListener('click', async () => {
            await this.restoreRevision(rev.file_id, rev.revision_id, remotePath);
        });

        // Save as Copy Action
        const copyBtn = actions.createEl('button', { text: t('view.history.btnSaveCopy') });
        copyBtn.addEventListener('click', async () => {
            await this.saveAsCopy(rev.file_id, rev.revision_id, date);
        });
    }

    private async restoreRevision(fileId: string, revisionId: string, remotePath: string) {
        if (!this.currentFile) return;

        try {
            new Notice(t('view.history.restoring'));
            
            // 1. Download the revision binary
            const buffer = await (await (this.plugin as any).getClient()).downloadRevision(fileId, revisionId);
            
            // 2. Overwrite local file
            await this.plugin.app.vault.modifyBinary(this.currentFile, buffer);
            
            // 3. Trigger remote restore to keep versions in sync
            try {
                await (await (this.plugin as any).getClient()).restoreRevision(fileId, revisionId);
            } catch (e) {
                console.warn('Remote restore failed, but local was restored.', e);
            }

            // 4. Update sync state hash
            const engine = await (this.plugin as any).getEngine();
            const state = (engine as any).state;
            const newHash = await calculateSHA256(buffer);
            
            // Refresh metadata to get new mtime/hash from server
            const meta = await (await (this.plugin as any).getClient()).getMetadata(remotePath);
            let remoteHash = newHash; // fallback
            if (meta?.data?.hash) remoteHash = meta.data.hash;

            state.updateFileState(this.currentFile.path, {
                local_mtime: this.currentFile.stat.mtime,
                local_hash: newHash,
                remote_hash: remoteHash
            });
            await state.save();

            new Notice(t('view.history.restoreSuccess'));
            
            // Refresh view
            await this.loadHistory();
        } catch (e: any) {
            console.error('Restore failed:', e);
            new Notice(t('view.history.restoreFailed') + ': ' + e.message);
        }
    }

    private async saveAsCopy(fileId: string, revisionId: string, date: Date) {
        if (!this.currentFile) return;

        try {
            new Notice(t('view.history.downloading'));
            const buffer = await (await (this.plugin as any).getClient()).downloadRevision(fileId, revisionId);
            
            const dir = this.currentFile.parent ? this.currentFile.parent.path + '/' : '';
            const extIdx = this.currentFile.name.lastIndexOf('.');
            const baseName = extIdx > -1 ? this.currentFile.name.substring(0, extIdx) : this.currentFile.name;
            const ext = extIdx > -1 ? this.currentFile.name.substring(extIdx) : '';
            
            const dateStr = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}_${date.getHours().toString().padStart(2,'0')}${date.getMinutes().toString().padStart(2,'0')}${date.getSeconds().toString().padStart(2,'0')}`;
            
            const newPath = `${dir}${baseName} (Rev ${dateStr})${ext}`;
            
            await this.plugin.app.vault.createBinary(newPath, buffer);
            new Notice(t('view.history.saveCopySuccess') + ': ' + newPath);
        } catch (e: any) {
            console.error('Save copy failed:', e);
            new Notice(t('view.history.saveCopyFailed') + ': ' + e.message);
        }
    }

    private setLoading(loading: boolean) {
        this.isLoading = loading;
        if (loading) {
            this.refreshIconEl.addClass('history-spinning');
        } else {
            this.refreshIconEl.removeClass('history-spinning');
        }
    }

    private formatSize(bytes: number): string {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}
