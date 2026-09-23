import { App, Modal, Setting, setIcon, Notice } from 'obsidian';
import { SynologyClient } from '../api/client';
import { t } from '../locales';

export class RemoteFolderModal extends Modal {
    client: SynologyClient;
    currentPath: string;
    onSelect: (path: string) => void;
    contentContainer!: HTMLElement;
    
    constructor(app: App, client: SynologyClient, onSelect: (path: string) => void) {
        super(app);
        this.client = client;
        this.onSelect = onSelect;
        this.currentPath = ''; // Root
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: t('browser.title') as string || 'Select Remote Folder' });
        
        // Navigation bar
        const navEl = contentEl.createDiv({ cls: 'syno-folder-nav' });
        navEl.style.display = 'flex';
        navEl.style.alignItems = 'center';
        navEl.style.marginBottom = '1rem';
        navEl.style.gap = '8px';
        
        const backBtn = navEl.createEl('button');
        setIcon(backBtn, 'arrow-left');
        backBtn.onclick = () => this.navigateUp();
        
        const pathDisplay = navEl.createSpan();
        pathDisplay.style.flexGrow = '1';
        pathDisplay.style.fontFamily = 'monospace';
        pathDisplay.style.wordBreak = 'break-all';
        
        // Use a container for the list so we can update it
        this.contentContainer = contentEl.createDiv();
        this.contentContainer.style.maxHeight = '400px';
        this.contentContainer.style.overflowY = 'auto';
        this.contentContainer.style.border = '1px solid var(--background-modifier-border)';
        this.contentContainer.style.borderRadius = '4px';
        this.contentContainer.style.padding = '8px';
        
        // Select button at bottom
        const footerEl = contentEl.createDiv({ cls: 'syno-folder-footer' });
        footerEl.style.marginTop = '1rem';
        footerEl.style.display = 'flex';
        footerEl.style.justifyContent = 'flex-end';
        
        new Setting(footerEl)
            .addButton(btn => btn
                .setButtonText(t('browser.selectFolder') as string || 'Select this folder')
                .setCta()
                .onClick(() => {
                    if (!this.currentPath) {
                        new Notice(t('browser.selectValid') as string || 'Please select a valid folder');
                        return;
                    }
                    this.onSelect(this.currentPath);
                    this.close();
                })
            );

        void this.renderList();
    }

    onClose() {
        this.contentEl.empty();
    }

    navigateUp() {
        if (!this.currentPath) return; // Already at root
        if (this.currentPath === '/mydrive' || this.currentPath === '/team-folders') {
            this.currentPath = '';
        } else {
            const parts = this.currentPath.split('/').filter(Boolean);
            parts.pop(); // Remove last segment
            if (parts.length === 1 && parts[0] === 'team-folders') {
                this.currentPath = '/team-folders';
            } else {
                this.currentPath = '/' + parts.join('/');
            }
        }
        void this.renderList();
    }

    async renderList() {
        this.contentContainer.empty();
        this.contentContainer.createDiv({ text: t('browser.loading') as string || 'Loading...', cls: 'syno-loading' });
        
        const pathDisplay = this.contentEl.querySelector('.syno-folder-nav span') as HTMLElement;
        if (pathDisplay) {
            pathDisplay.setText(this.currentPath || ' (Root)');
        }
        
        try {
            if (!this.currentPath) {
                // Root virtual directory
                this.contentContainer.empty();
                this.addFolderItem(t('browser.myDrive') as string || 'My Drive', '/mydrive', 'hard-drive');
                this.addFolderItem(t('browser.teamFolders') as string || 'Team Folders', '/team-folders', 'users');
            } else if (this.currentPath === '/team-folders') {
                // List team folders
                const res = await this.client.getTeamFolders() as any;
                this.contentContainer.empty();
                if (res?.success && res.data?.items) {
                    for (const item of res.data.items) {
                        this.addFolderItem(item.name, `/team-folders/${item.name}`, 'folder');
                    }
                }
            } else {
                // List standard files
                const res = await this.client.listFiles(this.currentPath) as any;
                this.contentContainer.empty();
                if (res?.success && res.data?.items) {
                    // Filter for directories
                    const dirs = res.data.items.filter((item: any) => item.isdir === true || item.type === 'dir' || item.type === 'folder');
                    
                    // Sort alphabetically
                    dirs.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
                    
                    if (dirs.length === 0) {
                        this.contentContainer.createDiv({ text: t('browser.empty') as string || 'Empty folder' });
                    }
                    
                    for (const dir of dirs) {
                        this.addFolderItem(dir.name, `${this.currentPath}/${dir.name}`, 'folder');
                    }
                }
            }
        } catch (e: unknown) {
            this.contentContainer.empty();
            const errDiv = this.contentContainer.createDiv({ cls: 'syno-error' });
            errDiv.style.color = 'var(--text-error)';
            errDiv.setText((e as Error).message || String(e));
        }
    }

    addFolderItem(name: string, targetPath: string, icon: string) {
        const itemEl = this.contentContainer.createDiv({ cls: 'syno-folder-item' });
        itemEl.style.display = 'flex';
        itemEl.style.alignItems = 'center';
        itemEl.style.padding = '8px';
        itemEl.style.cursor = 'pointer';
        itemEl.style.borderBottom = '1px solid var(--background-modifier-border)';
        
        itemEl.onmouseover = () => { itemEl.style.backgroundColor = 'var(--background-modifier-hover)'; };
        itemEl.onmouseout = () => { itemEl.style.backgroundColor = 'transparent'; };
        
        const iconEl = itemEl.createSpan();
        iconEl.style.marginRight = '8px';
        setIcon(iconEl, icon);
        
        itemEl.createSpan({ text: name });
        
        itemEl.onclick = () => {
            this.currentPath = targetPath;
            void this.renderList();
        };
    }
}
