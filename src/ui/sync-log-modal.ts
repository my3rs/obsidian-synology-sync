import { App, Modal, Setting, Notice } from 'obsidian';
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

        const controlsEl = contentEl.createDiv({ cls: 'sync-log-controls' });

        new Setting(controlsEl)
            .setName(t('ui.logModal.filterAll'))
            .addDropdown(dropdown => {
                dropdown.addOption('All', t('ui.logModal.filterAll'));
                dropdown.addOption('Upload', t('ui.logModal.filterUpload'));
                dropdown.addOption('Download', t('ui.logModal.filterDownload'));
                dropdown.addOption('Delete Local', t('ui.logModal.filterDelete') + ' Local');
                dropdown.addOption('Delete Remote', t('ui.logModal.filterDelete') + ' Remote');
                dropdown.addOption('Conflict', t('ui.logModal.filterConflict'));
                dropdown.addOption('Error', t('ui.logModal.filterError'));
                dropdown.setValue(this.filterAction);
                dropdown.onChange(value => {
                    this.filterAction = value;
                    this.renderLogs();
                });
            })
            .addText(text => {
                text.setPlaceholder(t('ui.logModal.searchPlaceholder'));
                text.onChange(value => {
                    this.searchText = value.toLowerCase();
                    this.renderLogs();
                });
            });

        const btnsEl = contentEl.createDiv({ cls: 'sync-log-buttons' });

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
