import { App, Modal } from 'obsidian';
import { SyncLogger } from '../sync/logger';
import { t } from '../locales';

export class SyncLogModal extends Modal {
    private logger: SyncLogger;

    constructor(app: App, logger: SyncLogger) {
        super(app);
        this.logger = logger;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: t('ui.logModal.title') });

        const logs = await this.logger.getLogs();
        if (logs.length === 0) {
            contentEl.createEl('p', { text: t('ui.logModal.empty') }).addClass('sync-log-empty');
            return;
        }

        const listContainer = contentEl.createDiv();
        listContainer.addClass('sync-log-container');

        for (const log of logs) {
            const item = listContainer.createDiv();
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
