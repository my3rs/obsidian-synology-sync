import { App, Modal, Setting } from 'obsidian';
import { SyncLogger, LogEntry } from '../sync/logger';

export class SyncLogModal extends Modal {
    private logger: SyncLogger;

    constructor(app: App, logger: SyncLogger) {
        super(app);
        this.logger = logger;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: 'Synology Sync 同步日志' });

        const logs = await this.logger.getLogs();
        if (logs.length === 0) {
            contentEl.createEl('p', { text: '暂无同步记录。' });
            return;
        }

        const listContainer = contentEl.createDiv();
        listContainer.style.maxHeight = '400px';
        listContainer.style.overflowY = 'auto';

        for (const log of logs) {
            const item = listContainer.createDiv();
            item.style.padding = '8px';
            item.style.borderBottom = '1px solid var(--background-modifier-border)';
            
            const timeStr = new Date(log.time).toLocaleString();
            
            const header = item.createDiv();
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.marginBottom = '4px';

            const actionEl = header.createSpan({ text: log.action });
            actionEl.style.fontWeight = 'bold';
            this.styleActionEl(actionEl, log.action);

            const timeEl = header.createSpan({ text: timeStr });
            timeEl.style.fontSize = '0.8em';
            timeEl.style.color = 'var(--text-muted)';

            const fileEl = item.createDiv({ text: log.file });
            fileEl.style.wordBreak = 'break-all';
            
            if (log.details) {
                const detailsEl = item.createDiv({ text: log.details });
                detailsEl.style.fontSize = '0.85em';
                detailsEl.style.color = 'var(--text-faint)';
                detailsEl.style.marginTop = '4px';
            }
        }
    }

    private styleActionEl(el: HTMLElement, action: string) {
        switch (action) {
            case 'Upload':
                el.style.color = 'var(--text-accent)';
                break;
            case 'Download':
                el.style.color = 'var(--text-success)';
                break;
            case 'Delete Local':
            case 'Delete Remote':
                el.style.color = 'var(--text-error)';
                break;
            case 'Conflict':
                el.style.color = 'var(--text-warning)';
                break;
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
