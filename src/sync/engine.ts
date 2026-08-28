import { App, TFile, Notice } from 'obsidian';
import { SynologyClient } from '../api/client';
import { SyncState } from './state';
import { calculateSHA256 } from './utils';
import { LocalFS } from '../fs/local';
import { SyncLogger } from './logger';
import { t } from '../locales';

export interface SyncPlan {
    uploads: Set<string>;
    downloads: Set<string>;
    deletionsLocal: Set<string>;
    deletionsRemote: Set<string>;
    conflicts: Set<string>;
}

interface SynologyResponse {
    data?: {
        hash?: string;
        file?: { hash?: string };
        files?: Array<{ path: string; hash: string; type: string }>;
    };
    hash?: string;
}


export class SyncEngine {
    private localFs: LocalFS;
    
    // 暂存当次同步的分析结果
    private localChanges: Map<string, { hash: string, mtime: number }> = new Map();
    private localDeletions: Set<string> = new Set();
    
    private remoteChanges: Map<string, { hash: string }> = new Map();
    private remoteDeletions: Set<string> = new Set();
    private isSyncing: boolean = false;

    constructor(
        private app: App,
        private client: SynologyClient,
        private state: SyncState,
        private logger: SyncLogger,
        private remoteFolder: string // 例如 /mydrive/ObsidianSync
    ) {
        this.localFs = new LocalFS(app);
    }

    private toRemotePath(localPath: string): string {
        let p = `${this.remoteFolder}/${localPath}`;
        if (!p.startsWith('/mydrive/') && !p.startsWith('/team-folders/')) {
            p = `/mydrive${p.startsWith('/') ? '' : '/'}${p}`;
        }
        return p.replace(/\/\//g, '/');
    }

    private toLocalPath(remotePath: string): string {
        let prefix = this.remoteFolder;
        if (!prefix.startsWith('/mydrive/') && !prefix.startsWith('/team-folders/')) {
            prefix = `/mydrive${prefix.startsWith('/') ? '' : '/'}${prefix}`;
        }
        prefix = prefix.replace(/\/\//g, '/');
        if (remotePath.startsWith(prefix)) {
            let local = remotePath.substring(prefix.length);
            if (local.startsWith('/')) local = local.substring(1);
            return local;
        }
        return remotePath;
    }

    /**
     * 运行同步
     */
    async runSync(fullScan: boolean = false, showNotice: boolean = false): Promise<boolean> {
        if (this.isSyncing) return false;
        
        let notice: Notice | null = null;
        try {
            this.isSyncing = true;
            if (showNotice) {
                notice = new Notice(t('notice.engine.syncing'), 0); // 0 means it won't auto-hide
            }
            
            await this.state.load();
            await this.detectLocalChanges();
            await this.detectRemoteChanges(fullScan ? 0 : this.state.getLastSyncTime());
            
            const plan = this.compareAndPlan();
            await this.executePlan(plan);
            
            this.state.setLastSyncTime(Math.floor(Date.now() / 1000));
            const hasChanges = plan.uploads.size > 0 || plan.downloads.size > 0 || plan.deletionsLocal.size > 0 || plan.deletionsRemote.size > 0 || plan.conflicts.size > 0;
            
            if (hasChanges || fullScan) {
                await this.state.save();
            }
            
            if (notice) {
                notice.setMessage(hasChanges ? t('notice.engine.syncSuccess') : t('notice.engine.syncUpToDate'));
                window.setTimeout(() => notice?.hide(), 3000);
            }
            
            return hasChanges;
        } catch (e: unknown) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.error('Sync Error', e);
            if (notice) {
                notice.setMessage(t('notice.syncException', { error: errorMsg }));
                window.setTimeout(() => notice?.hide(), 5000);
            }
            throw e;
        } finally {
            this.isSyncing = false;
        }
    }

    async forceUpload(): Promise<boolean> {
        if (this.isSyncing) return false;
        try {
            this.isSyncing = true;
            await this.state.load();
            await this.detectLocalChanges();
            await this.detectRemoteChanges(0);
            const plan = this.compareForForceUpload();
            await this.executePlan(plan);
            this.state.setLastSyncTime(Math.floor(Date.now() / 1000));
            await this.state.save();
            return true;
        } finally {
            this.isSyncing = false;
        }
    }

    async forceDownload(): Promise<boolean> {
        if (this.isSyncing) return false;
        try {
            this.isSyncing = true;
            await this.state.load();
            await this.detectLocalChanges();
            await this.detectRemoteChanges(0);
            const plan = this.compareForForceDownload();
            await this.executePlan(plan);
            this.state.setLastSyncTime(Math.floor(Date.now() / 1000));
            await this.state.save();
            return true;
        } finally {
            this.isSyncing = false;
        }
    }

    async rebuildSyncState(): Promise<boolean> {
        this.state.clear();
        await this.state.save();
        return await this.runSync(true);
    }

    /**
     * 第一步：本地检测 O(1) 预筛 + Hash 计算
     */
    private async detectLocalChanges() {
        this.localChanges.clear();
        this.localDeletions.clear();

        const allFiles = this.app.vault.getFiles();
        const currentPaths = new Set<string>();

        for (const file of allFiles) {
            // 默认忽略 .obsidian 配置文件夹，避免配置冲突
            if (file.path.startsWith(this.app.vault.configDir + '/')) continue;
            
            currentPaths.add(file.path);
            
            const state = this.state.getFileState(file.path);
            const currentMtime = file.stat.mtime;

            if (!state) {
                // 新文件
                const buffer = await this.app.vault.readBinary(file);
                const hash = await calculateSHA256(buffer);
                this.localChanges.set(file.path, { hash, mtime: currentMtime });
            } else if (state.local_mtime !== currentMtime) {
                // mtime 改变，进一步检查 Hash
                const buffer = await this.app.vault.readBinary(file);
                const hash = await calculateSHA256(buffer);
                if (hash !== state.local_hash) {
                    this.localChanges.set(file.path, { hash, mtime: currentMtime });
                } else {
                    // mtime 变了但内容没变，静默更新 mtime
                    state.local_mtime = currentMtime;
                    this.state.updateFileState(file.path, state);
                }
            }
        }

        // 检测本地删除
        for (const savedPath of this.state.getAllPaths()) {
            if (!currentPaths.has(savedPath)) {
                this.localDeletions.add(savedPath);
            }
        }
    }

    /**
     * 第二步：远端检测 O(1) 增量拉取
     */
    private async detectRemoteChanges(lastSyncTime: number) {
        this.remoteChanges.clear();
        this.remoteDeletions.clear();

        if (lastSyncTime === 0) {
            // 首次同步 (没有快照)，不能走增量，必须走全量拉取
            await this.fullRemoteScan(this.remoteFolder);
            return;
        }

        // 1. 增量获取被修改的文件
        const filesRes = await this.client.search(this.remoteFolder, 'file', lastSyncTime) as SynologyResponse;
        if (filesRes?.data?.files) {
            for (const item of filesRes.data.files) {
                const localPath = this.toLocalPath(item.path);
                if (localPath.startsWith(this.app.vault.configDir + '/')) continue;
                this.remoteChanges.set(localPath, { hash: item.hash });
            }
        }

        // 2. 增量获取发生结构变动（内部删减过文件）的文件夹，以抓取被删除的文件
        const foldersRes = await this.client.search(this.remoteFolder, 'folder', lastSyncTime) as SynologyResponse;
        if (foldersRes?.data?.files) {
            for (const folder of foldersRes.data.files) {
                const folderLocal = this.toLocalPath(folder.path);
                
                // 对变动过的文件夹进行一次 listFiles，看看少了谁
                const listRes = await this.client.listFiles(folder.path) as SynologyResponse;
                const currentFiles = new Set<string>();
                if (listRes?.data?.files) {
                    for (const f of listRes.data.files) {
                        if (f.type === 'file') currentFiles.add(this.toLocalPath(f.path));
                    }
                }

                // 对比该目录下的 sync_data 快照
                const snapshotPaths = this.state.getAllPaths().filter(p => {
                    const parent = p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : '';
                    return parent === folderLocal;
                });

                for (const p of snapshotPaths) {
                    if (!currentFiles.has(p)) {
                        this.remoteDeletions.add(p);
                    }
                }
            }
        }
    }

    private async fullRemoteScan(remotePath: string) {
        try {
            const res = await this.client.listFiles(remotePath) as SynologyResponse;
            if (res?.data?.files) {
                for (const f of res.data.files) {
                    if (f.type === 'file') {
                        const localPath = this.toLocalPath(f.path);
                        if (localPath.startsWith(this.app.vault.configDir + '/')) continue;
                        this.remoteChanges.set(localPath, { hash: f.hash });
                    } else if (f.type === 'folder') {
                        await this.fullRemoteScan(f.path);
                    }
                }
            }
        } catch (e: unknown) {
            // 如果根目录不存在 (刚安装)，listFiles 会报错 404
            // 我们可以在第一次捕获并静默，让后续逻辑去创建
            if (remotePath === this.remoteFolder) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                console.warn("Remote root directory does not exist, will create automatically", errorMsg);
                try { await this.client.createFolder(this.remoteFolder); } catch { /* ignore */ }
            } else {
                throw e;
            }
        }
    }

    /**
     * 第三步：三向比对，生成执行计划
     */
    private compareAndPlan(): SyncPlan {
        const plan: SyncPlan = {
            uploads: new Set(), downloads: new Set(),
            deletionsLocal: new Set(), deletionsRemote: new Set(), conflicts: new Set()
        };

        // 收集所有涉及变动的文件路径
        const allPaths = new Set([
            ...this.localChanges.keys(),
            ...this.remoteChanges.keys(),
            ...this.localDeletions,
            ...this.remoteDeletions
        ]);

        for (const path of allPaths) {
            const local = this.localChanges.get(path);
            const remote = this.remoteChanges.get(path);
            const deletedLocally = this.localDeletions.has(path);
            const deletedRemotely = this.remoteDeletions.has(path);

            if (deletedLocally && deletedRemotely) {
                // 两边都删除了，直接从状态表移除
                this.state.removeFileState(path);
            } else if (deletedLocally) {
                if (remote) plan.conflicts.add(path); // 本地删除，远端修改 -> 冲突恢复
                else plan.deletionsRemote.add(path); // 远端同步删除
            } else if (deletedRemotely) {
                if (local) plan.conflicts.add(path); // 远端删除，本地修改 -> 冲突恢复
                else plan.deletionsLocal.add(path); // 本地同步删除
            } else if (local && remote) {
                // 因为 Hash 是异构的，所以只要两边都出现了改变，就一律视为冲突（包含首次同步）
                plan.conflicts.add(path);
            } else if (local) {
                plan.uploads.add(path);
            } else if (remote) {
                plan.downloads.add(path);
            }
        }

        return plan;
    }

    private compareForForceUpload(): SyncPlan {
        const plan: SyncPlan = {
            uploads: new Set(), downloads: new Set(),
            deletionsLocal: new Set(), deletionsRemote: new Set(), conflicts: new Set()
        };
        const allFiles = this.app.vault.getFiles();
        const currentPaths = new Set<string>();
        for (const file of allFiles) {
            if (file.path.startsWith(this.app.vault.configDir + '/')) continue;
            plan.uploads.add(file.path);
            currentPaths.add(file.path);
        }
        for (const path of this.remoteChanges.keys()) {
            if (!currentPaths.has(path)) {
                plan.deletionsRemote.add(path);
            }
        }
        return plan;
    }

    private compareForForceDownload(): SyncPlan {
        const plan: SyncPlan = {
            uploads: new Set(), downloads: new Set(),
            deletionsLocal: new Set(), deletionsRemote: new Set(), conflicts: new Set()
        };
        for (const path of this.remoteChanges.keys()) {
            plan.downloads.add(path);
        }
        const allFiles = this.app.vault.getFiles();
        for (const file of allFiles) {
            if (file.path.startsWith(this.app.vault.configDir + '/')) continue;
            if (!this.remoteChanges.has(file.path)) {
                plan.deletionsLocal.add(file.path);
            }
        }
        return plan;
    }

    /**
     * 第四步：执行计划 (断点续传/原子更新)
     */
    private async executePlan(plan: SyncPlan) {
        const { uploads, downloads, deletionsLocal, deletionsRemote, conflicts } = plan;

        // 1. Uploads
        for (const path of uploads) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                try {
                    const buffer = await this.app.vault.readBinary(file);
                    const uploadRes = await this.client.uploadFile(this.toRemotePath(path), buffer);
                    
                    const remoteMeta = await this.client.getMetadata(this.toRemotePath(path));
                    const rHash = this.extractHash(remoteMeta) || this.extractHash(uploadRes);
                    if (!rHash) console.warn(`Failed to get Hash from remote, path: ${path}`, remoteMeta);

                    this.state.updateFileState(path, {
                        local_mtime: file.stat.mtime,
                        local_hash: this.localChanges.get(path)!.hash,
                        remote_hash: rHash
                    });
                    await this.state.save();
                    await this.logger.addLog({ action: 'Upload', file: path });
                } catch (e: unknown) {
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    console.error(`[SynologySync] Error uploading file ${path}:`, e);
                    await this.logger.addLog({ action: 'Error', file: path, details: errorMsg });
                }
            }
        }

        for (const path of downloads) {
            const buffer = await this.client.downloadFile(this.toRemotePath(path));
            await this.localFs.write(path, buffer);
            
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const localHash = await calculateSHA256(buffer);
                this.state.updateFileState(path, {
                    local_mtime: file.stat.mtime,
                    local_hash: localHash,
                    remote_hash: this.remoteChanges.get(path)!.hash
                });
                await this.state.save();
            }
            await this.logger.addLog({ action: 'Download', file: path });
        }

        // 3. Deletions (Remote)
        for (const path of deletionsRemote) {
            try { await this.client.deleteFile(this.toRemotePath(path)); } catch { /* ignore */ }
            this.state.removeFileState(path);
            await this.state.save();
            await this.logger.addLog({ action: 'Delete Remote', file: path });
        }

        // 4. Deletions (Local)
        for (const path of deletionsLocal) {
            await this.localFs.delete(path);
            this.state.removeFileState(path);
            await this.state.save();
            await this.logger.addLog({ action: 'Delete Local', file: path });
        }

        // 5. Conflicts (保留本地，下载远端产生副本，并以上传本地为最新线)
        for (const path of conflicts) {
            const buffer = await this.client.downloadFile(this.toRemotePath(path));
            
            const extIdx = path.lastIndexOf('.');
            const base = extIdx > -1 ? path.substring(0, extIdx) : path;
            const ext = extIdx > -1 ? path.substring(extIdx) : '';
            const dateStr = new Date().toISOString().split('T')[0];
            const conflictPath = `${base} (Sync Conflict ${dateStr})${ext}`;
            
            await this.localFs.write(conflictPath, buffer);
            
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                try {
                    const localBuffer = await this.app.vault.readBinary(file);
                    const uploadRes = await this.client.uploadFile(this.toRemotePath(path), localBuffer);
                    
                    const remoteMeta = await this.client.getMetadata(this.toRemotePath(path));
                    const rHash = this.extractHash(remoteMeta) || this.extractHash(uploadRes);
                    if (!rHash) console.warn(`Failed to get Hash from remote, conflict path: ${path}`, remoteMeta);

                    const localHash = await calculateSHA256(localBuffer);
                    this.state.updateFileState(path, {
                        local_mtime: file.stat.mtime,
                        local_hash: localHash,
                        remote_hash: rHash
                    });
                    await this.state.save();
                    await this.logger.addLog({ action: 'Conflict', file: path, details: `Keep local, save copy as ${conflictPath}` });
                } catch (e: unknown) {
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    console.error(`[SynologySync] Error uploading conflict file ${path}:`, e);
                    await this.logger.addLog({ action: 'Error', file: path, details: errorMsg });
                }
            }
        }
        
        // 收尾：如果发生过同步，保存日志并静默上传到云端
        const hasChanges = uploads.size > 0 || downloads.size > 0 || deletionsLocal.size > 0 || deletionsRemote.size > 0 || conflicts.size > 0;
        if (hasChanges) {
            await this.logger.flush();
            try {
                const buffer = await this.logger.getLogContentBuffer();
                if (buffer) {
                    await this.client.uploadFile(this.toRemotePath('.sync_history.json'), buffer);
                }
            } catch (e: unknown) {
                console.warn("Failed to upload .sync_history.json", e);
            }
        }
    }

    private extractHash(inputObj: unknown): string {
        const obj = inputObj as SynologyResponse;
        if (!obj) return '';
        if (typeof obj.hash === 'string') return obj.hash;
        if (obj.data) {
            if (typeof obj.data.hash === 'string') return obj.data.hash;
            if (obj.data.file && typeof obj.data.file.hash === 'string') return obj.data.file.hash;
            if (Array.isArray(obj.data.files) && obj.data.files[0] && typeof obj.data.files[0].hash === 'string') {
                return obj.data.files[0].hash;
            }
        }
        return '';
    }
}
