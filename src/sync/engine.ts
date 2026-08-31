import { App, TFile, TFolder, Notice } from 'obsidian';
import { SynologyClient } from '../api/client';
import { SyncState, LocalFileEntry } from './state';
import { calculateSHA256 } from './utils';
import { LocalFS } from '../fs/local';
import { SyncLogger } from './logger';
import { t } from '../locales';
import { ManifestManager, SyncManifest } from './manifest';
import { computeSyncPlan, LocalFileInfo, SyncPlan } from './differ';
import { ConflictResolutionModal } from '../ui/conflict-modal';

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
                await this.manifestManager.uploadManifest(manifest);
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
            await this.manifestManager.uploadManifest(manifest);
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

            for (const [path, entry] of Object.entries(manifest.files)) {
                if (!entry.deleted) {
                    plan.downloads.add(path);
                }
            }

            if (Object.keys(manifest.files).length === 0) {
                console.warn("Remote manifest is empty. Skipping local deletions.");
            } else {
                for (const path of localFiles.keys()) {
                    if (!manifest.files[path] || manifest.files[path].deleted) {
                        plan.deletionsLocal.add(path);
                    }
                }
            }

            await this.executePlan(plan, manifest, deviceId, localFiles);
            await this.manifestManager.uploadManifest(manifest);
            await this.state.save();
            return true;
        } finally {
            if (lockAcquired && deviceId) await this.manifestManager.releaseLock(deviceId);
            this.isSyncing = false;
        }
    }

    async rebuildSyncState(): Promise<boolean> {
        this.state.clear();
        await this.state.save();
        return await this.runSync(true);
    }

    private async detectLocalChanges(): Promise<Map<string, LocalFileInfo>> {
        const localFiles = new Map<string, LocalFileInfo>();
        const allFiles = this.app.vault.getFiles();

        for (const file of allFiles) {
            if (file.path.startsWith(this.app.vault.configDir + '/')) continue;
            // 忽略同步本身的元数据文件
            if (file.name === '.sync_manifest.json' || file.name === '.sync_lock') continue;
            
            const state = this.state.getFileState(file.path);
            const currentMtime = file.stat.mtime;

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
        for (const path of uploads) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                try {
                    const buffer = await this.app.vault.readBinary(file);
                    await this.client.uploadFile(this.toRemotePath(path), buffer);
                    
                    const localInfo = localFiles.get(path);
                    const localHash = localInfo ? localInfo.hash : await calculateSHA256(buffer);
                    
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
                } catch (e: unknown) {
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    console.error(`[SynologySync] Error uploading file ${path}:`, e);
                    await this.logger.addLog({ action: 'Error', file: path, details: errorMsg });
                }
            }
        }

        // Downloads
        for (const path of downloads) {
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
        }

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
            const localInfo = localFiles.get(path);
            const manifestEntry = manifest.files[path];
            
            const localMtime = localInfo ? localInfo.mtime : 0;
            const remoteMtime = manifestEntry ? manifestEntry.updatedAt : 0;
            
            const modal = new ConflictResolutionModal(this.app, path, localMtime, remoteMtime);
            const resolution = await modal.waitForResolution();

            if (resolution === 'local') {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const buffer = await this.app.vault.readBinary(file);
                    await this.client.uploadFile(this.toRemotePath(path), buffer);
                    
                    const localHash = localInfo ? localInfo.hash : await calculateSHA256(buffer);
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
                    await this.logger.addLog({ action: 'Conflict', file: path, details: 'Resolved: Keep Local' });
                    hasChanges = true;
                }
            } else if (resolution === 'remote') {
                const buffer = await this.client.downloadFile(this.toRemotePath(path));
                await this.localFs.write(path, buffer);
                
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    this.state.updateFileState(path, {
                        localMtime: file.stat.mtime,
                        localHash: manifestEntry!.hash,
                        syncedRev: manifestEntry!.rev,
                        syncedHash: manifestEntry!.hash
                    });
                }
                await this.logger.addLog({ action: 'Conflict', file: path, details: 'Resolved: Keep Remote' });
                hasChanges = true;
            } else {
                // 'both': keep local, download remote as copy
                const buffer = await this.client.downloadFile(this.toRemotePath(path));
                
                const extIdx = path.lastIndexOf('.');
                const base = extIdx > -1 ? path.substring(0, extIdx) : path;
                const ext = extIdx > -1 ? path.substring(extIdx) : '';
                const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const shortDeviceId = deviceId.slice(0, 6);
                const conflictPath = `${base} (Conflict ${ts} ${shortDeviceId})${ext}`;
                
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
                    
                    await this.logger.addLog({ action: 'Conflict', file: path, details: `Resolved: Both. Kept local, saved remote as ${conflictPath}` });
                    hasChanges = true;
                }
            }
        }
        
        if (hasChanges) {
            await this.logger.flush();
        }
        return hasChanges;
    }
}
