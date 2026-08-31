import { App, Modal, Setting } from 'obsidian';
import { t } from '../locales';

export type ConflictResolution = 'local' | 'remote' | 'both';

export class ConflictResolutionModal extends Modal {
    private resolvePromise!: (resolution: ConflictResolution) => void;
    
    constructor(
        app: App,
        private filePath: string,
        private localMtime: number,
        private remoteMtime: number
    ) {
        super(app);
    }

    async waitForResolution(): Promise<ConflictResolution> {
        return new Promise((resolve) => {
            this.resolvePromise = resolve;
            this.open();
        });
    }

    private formatDate(ts: number): string {
        return new Date(ts).toLocaleString();
    }

    onOpen() {
        const { contentEl } = this;
        
        contentEl.createEl('h2', { text: t('ui.conflictModal.title') });
        contentEl.createEl('p', { text: t('ui.conflictModal.desc', { file: this.filePath }) });
        
        const infoDiv = contentEl.createDiv('conflict-info');
        infoDiv.setCssStyles({
            margin: '1em 0',
            padding: '1em',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '4px'
        });

        infoDiv.createDiv({ text: `${t('ui.conflictModal.localTime')}: ${this.formatDate(this.localMtime)}` });
        infoDiv.createDiv({ text: `${t('ui.conflictModal.remoteTime')}: ${this.formatDate(this.remoteMtime)}` });

        new Setting(contentEl)
            .setName(t('ui.conflictModal.keepLocal'))
            .setDesc(t('ui.conflictModal.keepLocalDesc'))
            .addButton((btn) => 
                btn
                    .setButtonText(t('ui.conflictModal.btnLocal'))
                    .setCta()
                    .onClick(() => {
                        this.resolvePromise('local');
                        this.close();
                    })
            );

        new Setting(contentEl)
            .setName(t('ui.conflictModal.keepRemote'))
            .setDesc(t('ui.conflictModal.keepRemoteDesc'))
            .addButton((btn) => 
                btn
                    .setButtonText(t('ui.conflictModal.btnRemote'))
                    .onClick(() => {
                        this.resolvePromise('remote');
                        this.close();
                    })
            );

        new Setting(contentEl)
            .setName(t('ui.conflictModal.keepBoth'))
            .setDesc(t('ui.conflictModal.keepBothDesc'))
            .addButton((btn) => 
                btn
                    .setButtonText(t('ui.conflictModal.btnBoth'))
                    .onClick(() => {
                        this.resolvePromise('both');
                        this.close();
                    })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        // If user closes by clicking outside, default to 'both' to be safe
        if (this.resolvePromise) {
            this.resolvePromise('both');
        }
    }
}
