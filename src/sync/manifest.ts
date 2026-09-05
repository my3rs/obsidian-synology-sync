import { SynologyClient } from '../api/client';

export interface ManifestEntry {
    rev: number;
    hash: string;
    size: number;
    updatedBy: string;
    updatedAt: number;
    deleted?: boolean;
    deletedAt?: number;
}

export interface SyncManifest {
    schemaVersion: 1;
    files: Record<string, ManifestEntry>;
}

interface LockFile {
    deviceId: string;
    lockedAt: number;
    expiresAt: number;
}

const LOCK_TTL = 120_000;      // 2 minutes
const LOCK_RETRY_INTERVAL = 3000;
const LOCK_MAX_RETRIES = 5;

const MANIFEST_FILENAME = '.sync_manifest.json';
const LOCK_FILENAME = '.sync_lock';
const TOMBSTONE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export class ManifestManager {
    private heartbeatTimer: number | null = null;

    constructor(
        private client: SynologyClient,
        private remoteFolder: string
    ) {}

    private toRemotePath(filename: string): string {
        return `${this.remoteFolder}/${filename}`.replace(/\/\//g, '/');
    }

    private stringToBuffer(str: string): ArrayBuffer {
        return new TextEncoder().encode(str).buffer;
    }

    private bufferToString(buffer: ArrayBuffer): string {
        return new TextDecoder().decode(buffer);
    }

    async acquireLock(deviceId: string): Promise<boolean> {
        let retries = 0;
        while (retries < LOCK_MAX_RETRIES) {
            try {
                const lockBuffer = await this.client.downloadFile(this.toRemotePath(LOCK_FILENAME));
                const lockContent = this.bufferToString(lockBuffer);
                if (lockContent) {
                    const lockData = JSON.parse(lockContent) as LockFile;
                    const now = Date.now();
                    
                    if (lockData.expiresAt > now && lockData.deviceId !== deviceId) {
                        // Locked by someone else and not expired
                        console.debug(`[SynologySync] Lock is held by ${lockData.deviceId}. Retrying... (${retries + 1}/${LOCK_MAX_RETRIES})`);
                        await new Promise(r => window.setTimeout(r, LOCK_RETRY_INTERVAL));
                        retries++;
                        continue;
                    }
                }
            } catch (e: unknown) {
                // Ignore download error, probably lock doesn't exist
                const errorMsg = e instanceof Error ? e.message : String(e);
                if (!errorMsg.includes('1003') && !errorMsg.includes('404') && !errorMsg.includes('400')) {
                    // 1003 is often "File not found" in Synology API
                    console.warn(`[SynologySync] Error reading lock file, assuming not locked: ${errorMsg}`);
                }
            }

            // We can take the lock
            const now = Date.now();
            const newLock: LockFile = {
                deviceId,
                lockedAt: now,
                expiresAt: now + LOCK_TTL
            };
            
            try {
                await this.client.uploadFile(this.toRemotePath(LOCK_FILENAME), this.stringToBuffer(JSON.stringify(newLock)));
                this.startHeartbeat(deviceId);
                return true;
            } catch (e: unknown) {
                console.error(`[SynologySync] Failed to write lock file:`, e);
                return false;
            }
        }
        
        console.warn(`[SynologySync] Failed to acquire lock after ${LOCK_MAX_RETRIES} retries.`);
        return false;
    }

    async releaseLock(deviceId: string): Promise<void> {
        this.stopHeartbeat();
        try {
            // Verify lock ownership before releasing
            const lockBuffer = await this.client.downloadFile(this.toRemotePath(LOCK_FILENAME));
            const lockContent = this.bufferToString(lockBuffer);
            if (lockContent) {
                const lockData = JSON.parse(lockContent) as LockFile;
                if (lockData.deviceId !== deviceId) {
                    console.warn(`[SynologySync] Cannot release lock: held by ${lockData.deviceId}`);
                    return;
                }
            }
            await this.client.deleteFile(this.toRemotePath(LOCK_FILENAME));
        } catch (e: unknown) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            if (!errorMsg.includes('1003') && !errorMsg.includes('404') && !errorMsg.includes('400')) {
                console.error(`[SynologySync] Failed to release lock:`, e);
            }
        }
    }

    startHeartbeat(deviceId: string) {
        this.stopHeartbeat();
        // Renew lock every half of TTL
        this.heartbeatTimer = window.setInterval(() => {
            void (async () => {
                try {
                    const now = Date.now();
                    const newLock: LockFile = {
                        deviceId,
                        lockedAt: now, // We can just update lockedAt to now
                        expiresAt: now + LOCK_TTL
                    };
                    await this.client.uploadFile(this.toRemotePath(LOCK_FILENAME), this.stringToBuffer(JSON.stringify(newLock)));
                } catch (e) {
                    console.warn(`[SynologySync] Failed to renew lock heartbeat:`, e);
                }
            })();
        }, Math.floor(LOCK_TTL / 2));
    }

    stopHeartbeat() {
        if (this.heartbeatTimer !== null) {
            window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    async downloadManifest(): Promise<SyncManifest> {
        try {
            const buffer = await this.client.downloadFile(this.toRemotePath(MANIFEST_FILENAME));
            const content = this.bufferToString(buffer);
            if (content) {
                const parsed = JSON.parse(content) as unknown;
                if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed && (parsed as Record<string, unknown>).schemaVersion === 1) {
                    return parsed as SyncManifest;
                }
            }
        } catch (e: unknown) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            // 1003, 404, and sometimes 400 mean file not found. In this case, return an empty manifest.
            if (errorMsg.includes('1003') || errorMsg.includes('404') || errorMsg.includes('400')) {
                return {
                    schemaVersion: 1,
                    files: {}
                };
            }
            // For actual network errors or parsing errors, we MUST throw to prevent disastrous local deletions.
            console.error(`[SynologySync] Failed to download manifest:`, e);
            throw e;
        }
        
        // Return empty manifest if parsing fails but no exception was thrown (e.g. invalid format but downloaded successfully)
        return {
            schemaVersion: 1,
            files: {}
        };
    }

    async uploadManifest(manifest: SyncManifest, deviceId: string): Promise<void> {
        try {
            // Verify lock ownership before uploading manifest
            try {
                const lockBuffer = await this.client.downloadFile(this.toRemotePath(LOCK_FILENAME));
                const lockContent = this.bufferToString(lockBuffer);
                if (lockContent) {
                    const lockData = JSON.parse(lockContent) as LockFile;
                    if (lockData.deviceId !== deviceId) {
                        throw new Error(`Lock stolen by ${lockData.deviceId}. Cannot safely upload manifest.`);
                    }
                }
            } catch (e: unknown) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                if (!errorMsg.includes('1003') && !errorMsg.includes('404') && !errorMsg.includes('400')) {
                    console.warn(`[SynologySync] Lock verification failed: ${errorMsg}`);
                } else {
                    throw new Error(`Lock file missing. Cannot safely upload manifest.`);
                }
            }

            this.cleanupTombstones(manifest);
            const content = JSON.stringify(manifest);
            await this.client.uploadFile(this.toRemotePath(MANIFEST_FILENAME), this.stringToBuffer(content));
        } catch (e) {
            console.error(`[SynologySync] Failed to upload manifest:`, e);
            throw e;
        }
    }

    private cleanupTombstones(manifest: SyncManifest): void {
        const now = Date.now();
        const pathsToDelete: string[] = [];
        
        for (const [path, entry] of Object.entries(manifest.files)) {
            if (entry.deleted && entry.deletedAt && (now - entry.deletedAt > TOMBSTONE_MAX_AGE)) {
                pathsToDelete.push(path);
            }
        }
        
        for (const path of pathsToDelete) {
            delete manifest.files[path];
        }
    }
}
