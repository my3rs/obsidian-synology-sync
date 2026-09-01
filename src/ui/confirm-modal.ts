import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
    private message: string;
    private onConfirm: () => void | Promise<void>;
    private onCancel?: () => void | Promise<void>;

    constructor(app: App, message: string, onConfirm: () => void | Promise<void>, onCancel?: () => void | Promise<void>) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h3', { text: 'Confirm' });
        contentEl.createEl('p', { text: this.message });

        const buttonsEl = contentEl.createDiv();
        buttonsEl.addClass('sync-log-buttons');
        // Re-using sync-log-buttons

        const btnCancel = buttonsEl.createEl('button', { text: 'Cancel' });
        btnCancel.onclick = () => {
            if (this.onCancel) void this.onCancel();
            this.close();
        };

        const btnConfirm = buttonsEl.createEl('button', { text: 'Confirm' });
        btnConfirm.addClass('mod-warning');
        btnConfirm.onclick = () => {
            void this.onConfirm();
            this.close();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
