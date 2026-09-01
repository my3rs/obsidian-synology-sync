import { App, Modal, Notice } from 'obsidian';
import { SyncLogger, LogEntry } from '../sync/logger';
import { t } from '../locales';
import { ConfirmModal } from './confirm-modal';

export class SyncLogModal extends Modal {
    private logger: SyncLogger;
    private logs: LogEntry[] = [];
    private searchText: string = '';
    private filterAction: string = 'All';
    private listContainer!: HTMLDivElement;

    constructor(app: App, logger: SyncLogger) {
        super(app);
        this.logger = logger;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('sync-log-modal-wrapper');
        
        contentEl.createEl('h2', { text: t('ui.logModal.title') });

        const topBarEl = contentEl.createDiv({ cls: 'sync-log-topbar' });

        const searchEl = topBarEl.createDiv({ cls: 'sync-log-search-bar' });
        
        searchEl.createSpan({ text: t('ui.logModal.filterAll') });
        const filterSelect = searchEl.createEl('select', { cls: 'dropdown' });
        filterSelect.createEl('option', { value: 'All', text: t('ui.logModal.filterAll') });
        filterSelect.createEl('option', { value: 'Upload', text: t('ui.logModal.filterUpload') });
        filterSelect.createEl('option', { value: 'Download', text: t('ui.logModal.filterDownload') });
        filterSelect.createEl('option', { value: 'Delete Local', text: t('ui.logModal.filterDelete') + ' Local' });
        filterSelect.createEl('option', { value: 'Delete Remote', text: t('ui.logModal.filterDelete') + ' Remote' });
        filterSelect.createEl('option', { value: 'Conflict', text: t('ui.logModal.filterConflict') });
        filterSelect.createEl('option', { value: 'Error', text: t('ui.logModal.filterError') });
        filterSelect.value = this.filterAction;
        filterSelect.onchange = () => {
            this.filterAction = filterSelect.value;
            this.renderLogs();
        };

        const searchInput = searchEl.createEl('input', { type: 'text', placeholder: t('ui.logModal.searchPlaceholder') });
        searchInput.oninput = () => {
            this.searchText = searchInput.value.toLowerCase();
            this.renderLogs();
        };

        const btnsEl = topBarEl.createDiv({ cls: 'sync-log-buttons' });

        const btnClearWeek = btnsEl.createEl('button', { text: t('ui.logModal.clearWeek') });
        btnClearWeek.onclick = () => {
            new ConfirmModal(this.app, t('ui.logModal.confirmClearWeek'), async () => {
                const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                await this.logger.clearLogsBefore(oneWeekAgo);
                new Notice(t('ui.logModal.clearWeek') + ' OK');
                await this.loadLogs();
            }).open();
        };

        const btnClearAll = btnsEl.createEl('button', { text: t('ui.logModal.clearAll') });
        btnClearAll.addClass('mod-warning');
        btnClearAll.onclick = () => {
            new ConfirmModal(this.app, t('ui.logModal.confirmClearAll'), async () => {
                await this.logger.clearAllLogs();
                new Notice(t('ui.logModal.clearAll') + ' OK');
                await this.loadLogs();
            }).open();
        };

        this.listContainer = contentEl.createDiv();
        this.listContainer.addClass('sync-log-container');

        await this.loadLogs();
    }

    async loadLogs() {
        this.logs = await this.logger.getLogs();
        this.renderLogs();
    }

    private renderLogs() {
        this.listContainer.empty();

        const filteredLogs = this.logs.filter(log => {
            if (this.filterAction !== 'All') {
                if (log.action !== this.filterAction) return false;
            }
            if (this.searchText) {
                if (!log.file.toLowerCase().includes(this.searchText)) {
                    return false;
                }
            }
            return true;
        });

        if (filteredLogs.length === 0) {
            this.listContainer.createEl('p', { text: t('ui.logModal.empty') }).addClass('sync-log-empty');
            return;
        }

        for (const log of filteredLogs) {
            const item = this.listContainer.createDiv();
            item.addClass('sync-log-item');
            
            const timeStr = new Date(log.time).toLocaleString();
            
            const header = item.createDiv();
            header.addClass('sync-log-header');

            const actionEl = header.createSpan({ text: log.action });
            actionEl.addClass('sync-log-action');
            this.styleActionEl(actionEl, log.action);

            const timeEl = header.createSpan({ text: timeStr });
            timeEl.addClass('sync-log-time');

            const fileEl = item.createDiv({ text: log.file });
            fileEl.addClass('sync-log-file');
            
            if (log.details) {
                const detailsEl = item.createDiv({ text: log.details });
                detailsEl.addClass('sync-log-details');
            }
        }
    }

    private styleActionEl(el: HTMLElement, action: string) {
        switch (action) {
            case 'Upload':
                el.addClass('upload');
                break;
            case 'Download':
                el.addClass('download');
                break;
            case 'Delete Local':
            case 'Delete Remote':
                el.addClass('delete');
                break;
            case 'Conflict':
                el.addClass('conflict');
                break;
            case 'Error':
                el.addClass('error');
                break;
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
