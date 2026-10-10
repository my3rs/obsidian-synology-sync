import { App, Modal, Setting, setIcon, Notice } from 'obsidian';
import { SynologyClient } from '../api/client';
import { t } from '../locales';


interface DriveItem {
    name: string;
    isdir?: boolean;
    type?: string;
    [key: string]: unknown;
}

interface SynoApiResponse {
    success?: boolean;
    data?: {
        items?: DriveItem[];
    };
}

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
        
        contentEl.createEl('h2', { text: t('browser.title') || 'Select Remote Folder' });
        
        // Navigation bar
        const navEl = contentEl.createDiv({ cls: 'syno-folder-nav' });
        navEl.setCssStyles({
            display: 'flex',
            alignItems: 'center',
            marginBottom: '1rem',
            gap: '8px'
        });
        
        const backBtn = navEl.createEl('button');
        setIcon(backBtn, 'arrow-left');
        backBtn.onclick = () => this.navigateUp();
        
        const pathDisplay = navEl.createSpan();
        pathDisplay.setCssStyles({
            flexGrow: '1',
            fontFamily: 'monospace',
            wordBreak: 'break-all'
        });
        
        // Use a container for the list so we can update it
        this.contentContainer = contentEl.createDiv();
        this.contentContainer.setCssStyles({
            maxHeight: '400px',
            overflowY: 'auto',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '4px',
            padding: '8px'
        });
        
        // Select button at bottom
        const footerEl = contentEl.createDiv({ cls: 'syno-folder-footer' });
        footerEl.setCssStyles({
            marginTop: '1rem',
            display: 'flex',
            justifyContent: 'flex-end'
        });
        
        new Setting(footerEl)
            .addButton(btn => btn
                .setButtonText(t('browser.selectFolder') || 'Select this folder')
                .setCta()
                .onClick(() => {
                    if (!this.currentPath) {
                        new Notice(t('browser.selectValid') || 'Please select a valid folder');
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
        this.contentContainer.createDiv({ text: t('browser.loading') || 'Loading...', cls: 'syno-loading' });
        
        const pathDisplay = this.contentEl.querySelector('.syno-folder-nav span') as HTMLElement;
        if (pathDisplay) {
            pathDisplay.setText(this.currentPath || ' (Root)');
        }
        
        try {
            if (!this.currentPath) {
                // Root virtual directory
                this.contentContainer.empty();
                this.addFolderItem(t('browser.myDrive') || 'My Drive', '/mydrive', 'hard-drive');
                this.addFolderItem(t('browser.teamFolders') || 'Team Folders', '/team-folders', 'users');
            } else if (this.currentPath === '/team-folders') {
                // List team folders
                const res = await this.client.getTeamFolders() as SynoApiResponse;
                this.contentContainer.empty();
                if (res?.success && res.data?.items) {
                    for (const item of res.data.items) {
                        this.addFolderItem(item.name, `/team-folders/${item.name}`, 'folder');
                    }
                }
            } else {
                // List standard files
                const res = await this.client.listFiles(this.currentPath) as SynoApiResponse;
                this.contentContainer.empty();
                if (res?.success && res.data?.items) {
                    // Filter for directories
                    const dirs = res.data.items.filter((item: DriveItem) => item.isdir === true || item.type === 'dir' || item.type === 'folder');
                    
                    // Sort alphabetically
                    dirs.sort((a: DriveItem, b: DriveItem) => (a.name || '').localeCompare(b.name || ''));
                    
                    if (dirs.length === 0) {
                        this.contentContainer.createDiv({ text: t('browser.empty') || 'Empty folder' });
                    }
                    
                    for (const dir of dirs) {
                        this.addFolderItem(dir.name, `${this.currentPath}/${dir.name}`, 'folder');
                    }
                }
            }
        } catch (e: unknown) {
            this.contentContainer.empty();
            const errDiv = this.contentContainer.createDiv({ cls: 'syno-error' });
            errDiv.setCssStyles({ color: 'var(--text-error)' });
            errDiv.setText((e as Error).message || String(e));
        }
    }

    addFolderItem(name: string, targetPath: string, icon: string) {
        const itemEl = this.contentContainer.createDiv({ cls: 'syno-folder-item' });
        itemEl.setCssStyles({
            display: 'flex',
            alignItems: 'center',
            padding: '8px',
            cursor: 'pointer',
            borderBottom: '1px solid var(--background-modifier-border)'
        });
        
        itemEl.onmouseover = () => { itemEl.setCssStyles({ backgroundColor: 'var(--background-modifier-hover)' }); };
        itemEl.onmouseout = () => { itemEl.setCssStyles({ backgroundColor: 'transparent' }); };
        
        const iconEl = itemEl.createSpan();
        iconEl.setCssStyles({ marginRight: '8px' });
        setIcon(iconEl, icon);
        
        itemEl.createSpan({ text: name });
        
        itemEl.onclick = () => {
            this.currentPath = targetPath;
            void this.renderList();
        };
    }
}
