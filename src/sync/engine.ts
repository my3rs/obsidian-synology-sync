import { App, TFile, TFolder, Notice } from 'obsidian';
import { SynologyClient } from '../api/client';
import { SyncState, LocalFileEntry } from './state';
import { calculateSHA256 } from './utils';
import { LocalFS } from '../fs/local';
import { SyncLogger } from './logger';
import { t } from '../locales';
import { ManifestManager, SyncManifest } from './manifest';
import { computeSyncPlan, LocalFileInfo, SyncPlan } from './differ';

async function runConcurrent<T>(items: Iterable<T>, concurrency: number, task: (item: T) => Promise<void>) {
    const queue = Array.from(items);
    const workers = new Array(concurrency).fill(null).map(async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            if (item) {
                await task(item);
            }
        }
    });
    await Promise.all(workers);
}

export class SyncEngine {
    private localFs: LocalFS;
    private manifestManager: ManifestManager;
    private isSyncing: boolean = false;

    constructor(
        private app: App,
        private client: SynologyClient,
        private state: SyncState,
        private logger: SyncLogger,
        private remoteFolder: string
    ) {
        if (!this.remoteFolder.startsWith('/mydrive/') && !this.remoteFolder.startsWith('/team-folders/')) {
            this.remoteFolder = `/mydrive${this.remoteFolder.startsWith('/') ? '' : '/'}${this.remoteFolder}`;
        }
        this.remoteFolder = this.remoteFolder.replace(/\/\//g, '/');
        this.localFs = new LocalFS(app);
        this.manifestManager = new ManifestManager(client, this.remoteFolder);
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
        
        let prefixWithoutRoot = prefix;
        if (prefix.startsWith('/mydrive')) prefixWithoutRoot = prefix.substring('/mydrive'.length);
        else if (prefix.startsWith('/team-folders')) prefixWithoutRoot = prefix.substring('/team-folders'.length);

        if (remotePath.startsWith(prefix)) {
            let local = remotePath.substring(prefix.length);
            if (local.startsWith('/')) local = local.substring(1);
            return local;
        } else if (remotePath.startsWith(prefixWithoutRoot)) {
            let local = remotePath.substring(prefixWithoutRoot.length);
            if (local.startsWith('/')) local = local.substring(1);
            return local;
        }
        
        return remotePath;
    }

    async runSync(fullScan: boolean = false, showNotice: boolean = false): Promise<boolean> {
        if (this.isSyncing) return false;
        
        let notice: Notice | null = null;
        let lockAcquired = false;
        let deviceId = '';
        
        try {
            this.isSyncing = true;
            if (showNotice) {
                notice = new Notice(t('notice.engine.syncing'), 0);
            }
            
            await this.state.load();
            deviceId = this.state.getDeviceId();
            
            lockAcquired = await this.manifestManager.acquireLock(deviceId);
            if (!lockAcquired) {
                if (notice) {
                    notice.setMessage('Sync skipped: Lock is held by another device.');
                    window.setTimeout(() => notice?.hide(), 3000);
                }
                return false;
            }
            
            const manifest = await this.manifestManager.downloadManifest();
            const localFiles = await this.detectLocalChanges();
            
            const snapshotsMap = new Map<string, LocalFileEntry>();
            for (const path of this.state.getAllPaths()) {
                const s = this.state.getFileState(path);
                if (s) snapshotsMap.set(path, s);
            }
            
            const plan = computeSyncPlan(
                localFiles, 
                snapshotsMap, 
                new Map(Object.entries(manifest.files))
            );
            
            const hasChanges = await this.executePlan(plan, manifest, deviceId, localFiles);
            
            if (hasChanges) {
                await this.manifestManager.uploadManifest(manifest, deviceId);
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
            if (lockAcquired && deviceId) {
                await this.manifestManager.releaseLock(deviceId);
            }
            this.isSyncing = false;
        }
    }

    async forceUpload(): Promise<boolean> {
        if (this.isSyncing) return false;
        let lockAcquired = false;
        let deviceId = '';
        try {
            this.isSyncing = true;
            await this.state.load();
            deviceId = this.state.getDeviceId();
            
            lockAcquired = await this.manifestManager.acquireLock(deviceId);
            if (!lockAcquired) throw new Error('Lock held by another device');

            const manifest = await this.manifestManager.downloadManifest();
            const localFiles = await this.detectLocalChanges();

            const plan: SyncPlan = {
                uploads: new Set(localFiles.keys()),
                downloads: new Set(),
                deletionsLocal: new Set(),
                deletionsRemote: new Set(),
                conflicts: new Set(),
                snapshotClears: new Set(),
                snapshotUpdates: new Map()
            };

            for (const path of Object.keys(manifest.files)) {
                if (!localFiles.has(path)) {
                    plan.deletionsRemote.add(path);
                }
            }

            const localFolders = this.app.vault.getAllLoadedFiles()
                .filter((f): f is TFolder => f instanceof TFolder && f.path !== '/' && f.path !== '')
                .filter(f => !f.path.startsWith(this.app.vault.configDir + '/'))
                .map(f => f.path)
                .sort((a, b) => a.split('/').length - b.split('/').length);

            for (const folderPath of localFolders) {
                try { await this.client.createFolder(this.toRemotePath(folderPath)); } catch { /* ignore */ }
            }

            await this.executePlan(plan, manifest, deviceId, localFiles);
            await this.manifestManager.uploadManifest(manifest, deviceId);
            await this.state.save();
            return true;
        } finally {
            if (lockAcquired && deviceId) await this.manifestManager.releaseLock(deviceId);
            this.isSyncing = false;
        }
    }

    async forceDownload(): Promise<boolean> {
        if (this.isSyncing) return false;
        let lockAcquired = false;
        let deviceId = '';
        try {
            this.isSyncing = true;
            await this.state.load();
            deviceId = this.state.getDeviceId();
            
            lockAcquired = await this.manifestManager.acquireLock(deviceId);
            if (!lockAcquired) throw new Error('Lock held by another device');

            const manifest = await this.manifestManager.downloadManifest();
            const localFiles = await this.detectLocalChanges();

            const plan: SyncPlan = {
                uploads: new Set(),
                downloads: new Set(),
                deletionsLocal: new Set(),
                deletionsRemote: new Set(),
                conflicts: new Set(),
                snapshotClears: new Set(),
                snapshotUpdates: new Map()
            };

            const remoteFiles = await this.fetchRemoteFileList();
            for (const path of remoteFiles) {
                plan.downloads.add(path);
            }
            
            // Also add any files from manifest that are not marked as deleted, just in case search missed them
            for (const [path, entry] of Object.entries(manifest.files)) {
                if (!entry.deleted && !plan.downloads.has(path)) {
                    plan.downloads.add(path);
                }
            }

            if (Object.keys(manifest.files).length === 0 && remoteFiles.size === 0) {
                console.warn("Remote manifest and remote folder are empty. Skipping local deletions for safety.");
            } else {
                for (const path of localFiles.keys()) {
                    const inManifestAndNotDeleted = manifest.files[path] && !manifest.files[path].deleted;
                    if (!remoteFiles.has(path) && !inManifestAndNotDeleted) {
                        plan.deletionsLocal.add(path);
                    }
                }
            }

            await this.executePlan(plan, manifest, deviceId, localFiles);
            await this.manifestManager.uploadManifest(manifest, deviceId);
            await this.state.save();
            return true;
        } finally {
            if (lockAcquired && deviceId) await this.manifestManager.releaseLock(deviceId);
            this.isSyncing = false;
        }
    }

    async rebuildSyncState(): Promise<boolean> {
        this.state.clear();
        const localFiles = await this.detectLocalChanges();
        const remoteFiles = await this.fetchRemoteFileList();
        
        let manifest: SyncManifest;
        try {
            manifest = await this.manifestManager.downloadManifest();
        } catch {
            manifest = { schemaVersion: 1, files: {} };
        }
        
        const deviceId = this.state.getDeviceId();
        
        for (const [path, localInfo] of localFiles.entries()) {
            if (remoteFiles.has(path)) {
                const rev = (manifest.files[path]?.rev || 0) + 1;
                const file = this.app.vault.getAbstractFileByPath(path);
                const size = file instanceof TFile ? file.stat.size : 0;
                
                manifest.files[path] = {
                    rev,
                    hash: localInfo.hash,
                    size,
                    updatedBy: deviceId,
                    updatedAt: Date.now()
                };
                
                this.state.updateFileState(path, {
                    localMtime: localInfo.mtime,
                    localHash: localInfo.hash,
                    syncedRev: rev,
                    syncedHash: localInfo.hash
                });
            }
        }
        
        await this.manifestManager.uploadManifest(manifest, deviceId);
        await this.state.save();
        
        return await this.runSync(true);
    }

    private async fetchRemoteFileList(): Promise<Set<string>> {
        const remoteFiles = new Set<string>();
        try {
            const res = await this.client.search(this.remoteFolder, 'file') as { data?: { items?: Array<{ path?: string }> } };
            if (res && res.data && Array.isArray(res.data.items)) {
                for (const item of res.data.items) {
                    let remotePath = item.path;
                    if (typeof remotePath !== 'string') continue;
                    // convert remotePath to localPath
                    if (remotePath.startsWith(this.remoteFolder)) {
                        let localPath = remotePath.substring(this.remoteFolder.length);
                        if (localPath.startsWith('/')) localPath = localPath.substring(1);
                        // Filter out hidden files and lock/manifest
                        if (localPath && !localPath.startsWith('.') && !localPath.includes('/.')) {
                            remoteFiles.add(localPath);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[SynologySync] Failed to fetch remote file list:`, e);
        }
        return remoteFiles;
    }

    private async detectLocalChanges(): Promise<Map<string, LocalFileInfo>> {
        const localFiles = new Map<string, LocalFileInfo>();
        const allFiles = this.app.vault.getFiles();
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

        for (const file of allFiles) {
            if (file.path.startsWith(this.app.vault.configDir + '/')) continue;
            // 忽略同步本身的元数据文件
            if (file.name === '.sync_manifest.json' || file.name === '.sync_lock') continue;
            
            const state = this.state.getFileState(file.path);
            const currentMtime = file.stat.mtime;

            if (file.stat.size > MAX_FILE_SIZE) {
                console.warn(`[SynologySync] Skipping large file: ${file.path} (${(file.stat.size / 1024 / 1024).toFixed(2)} MB)`);
                if (state) {
                    // Retain old state so it doesn't get deleted remotely
                    localFiles.set(file.path, { hash: state.localHash, mtime: state.localMtime });
                }
                continue;
            }

            if (!state) {
                const buffer = await this.app.vault.readBinary(file);
                const hash = await calculateSHA256(buffer);
                localFiles.set(file.path, { hash, mtime: currentMtime });
            } else if (state.localMtime !== currentMtime) {
                const buffer = await this.app.vault.readBinary(file);
                const hash = await calculateSHA256(buffer);
                localFiles.set(file.path, { hash, mtime: currentMtime });
            } else {
                localFiles.set(file.path, { hash: state.localHash, mtime: state.localMtime });
            }
        }
        return localFiles;
    }

    private async executePlan(
        plan: SyncPlan, 
        manifest: SyncManifest, 
        deviceId: string,
        localFiles: Map<string, LocalFileInfo>
    ): Promise<boolean> {
        const { uploads, downloads, deletionsLocal, deletionsRemote, conflicts, snapshotClears, snapshotUpdates } = plan;

        let hasChanges = false;
        
        for (const [path, state] of snapshotUpdates.entries()) {
            this.state.updateFileState(path, state);
            hasChanges = true;
        }
        
        for (const path of snapshotClears) {
            this.state.removeFileState(path);
            hasChanges = true;
        }

        // Uploads
        await runConcurrent(uploads, 3, async (path) => {
            try {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const buffer = await this.app.vault.readBinary(file);
                    await this.client.uploadFile(this.toRemotePath(path), buffer);
                    
                    const localHash = localFiles.get(path)?.hash || await calculateSHA256(buffer);
                    
                    const rev = (manifest.files[path]?.rev || 0) + 1;
                    manifest.files[path] = {
                        rev,
                        hash: localHash,
                        size: file.stat.size,
                        updatedBy: deviceId,
                        updatedAt: Date.now()
                    };

                    this.state.updateFileState(path, {
                        localMtime: file.stat.mtime,
                        localHash: localHash,
                        syncedRev: rev,
                        syncedHash: localHash
                    });
                    
                    await this.logger.addLog({ action: 'Upload', file: path });
                    hasChanges = true;
                }
            } catch (e: unknown) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                console.error(`[SynologySync] Error uploading file ${path}:`, e);
                await this.logger.addLog({ action: 'Error', file: path, details: errorMsg });
            }
        });

        // Downloads
        await runConcurrent(downloads, 3, async (path) => {
            try {
                const buffer = await this.client.downloadFile(this.toRemotePath(path));
                await this.localFs.write(path, buffer);
                
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const manifestEntry = manifest.files[path];
                    this.state.updateFileState(path, {
                        localMtime: file.stat.mtime,
                        localHash: manifestEntry!.hash,
                        syncedRev: manifestEntry!.rev,
                        syncedHash: manifestEntry!.hash
                    });
                }
                await this.logger.addLog({ action: 'Download', file: path });
                hasChanges = true;
            } catch (e: unknown) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                console.error(`[SynologySync] Error downloading file ${path}:`, e);
                await this.logger.addLog({ action: 'Error', file: path, details: errorMsg });
            }
        });

        // Deletions (Remote)
        for (const path of deletionsRemote) {
            try { await this.client.deleteFile(this.toRemotePath(path)); } catch { /* ignore */ }
            const rev = (manifest.files[path]?.rev || 0) + 1;
            manifest.files[path] = {
                rev,
                hash: '',
                size: 0,
                updatedBy: deviceId,
                updatedAt: Date.now(),
                deleted: true,
                deletedAt: Date.now()
            };
            this.state.removeFileState(path);
            await this.logger.addLog({ action: 'Delete Remote', file: path });
            hasChanges = true;
        }

        // Deletions (Local)
        for (const path of deletionsLocal) {
            await this.localFs.delete(path);
            this.state.removeFileState(path);
            await this.logger.addLog({ action: 'Delete Local', file: path });
            hasChanges = true;
        }

        // Conflicts
        for (const path of conflicts) {
            try {
                const localInfo = localFiles.get(path);
                const manifestEntry = manifest.files[path];
                
                // Automated resolution: keep local, download remote as conflict copy
                const buffer = await this.client.downloadFile(this.toRemotePath(path));
                
                const extIdx = path.lastIndexOf('.');
                const base = extIdx > -1 ? path.substring(0, extIdx) : path;
                const ext = extIdx > -1 ? path.substring(extIdx) : '';
                const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                
                // If manifestEntry is missing, remote was modified from unknown device
                const remoteDeviceId = manifestEntry ? manifestEntry.updatedBy.slice(0, 6) : 'unknown';
                const conflictPath = `${base} (Conflict ${ts} ${remoteDeviceId})${ext}`;
                
                await this.localFs.write(conflictPath, buffer);
                
                // Now upload local as the main version
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const localBuffer = await this.app.vault.readBinary(file);
                    await this.client.uploadFile(this.toRemotePath(path), localBuffer);
                    
                    const localHash = localInfo ? localInfo.hash : await calculateSHA256(localBuffer);
                    const rev = (manifest.files[path]?.rev || 0) + 1;
                    manifest.files[path] = {
                        rev,
                        hash: localHash,
                        size: file.stat.size,
                        updatedBy: deviceId,
                        updatedAt: Date.now()
                    };
                    this.state.updateFileState(path, {
                        localMtime: file.stat.mtime,
                        localHash,
                        syncedRev: rev,
                        syncedHash: localHash
                    });
                }
                
                const logMsg = `Auto-resolved: Kept local, saved remote as ${conflictPath}`;
                await this.logger.addLog({ action: 'Conflict', file: path, details: logMsg });
                new Notice(`Sync Conflict: ${path}\n${logMsg}`);
                hasChanges = true;
            } catch (e: unknown) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                console.error(`[SynologySync] Error resolving conflict for ${path}:`, e);
                await this.logger.addLog({ action: 'Error', file: path, details: `Conflict resolution failed: ${errorMsg}` });
            }
        }
        
        if (hasChanges) {
            await this.logger.flush();
        }
        return hasChanges;
    }
}
