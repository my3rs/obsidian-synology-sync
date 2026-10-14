import { App, TFile } from 'obsidian';
import { t } from '../locales';
import { validPath } from '../sync/validation';
import { assertActive } from '../sync/cancellation';

const syncWrites = new WeakMap<App, Map<string, number>>();

/** Vault events emitted by our own writes must not become user deletion intent. */
export function isSyncWrite(app: App, path: string): boolean {
	return (syncWrites.get(app)?.get(path) ?? 0) > 0;
}

export function isSyncablePath(app: App, path: string): boolean {
	return validPath(path) && path !== app.vault.configDir && !path.startsWith(app.vault.configDir + '/');
}

export class LocalFS {
	private app: App;

	constructor(app: App, private signal?: AbortSignal) {
		this.app = app;
	}

	/**
	 * 读取本地文件的 ArrayBuffer (方便与云端二进制对比或上传)
	 */
	async read(path: string): Promise<ArrayBuffer | null> {
		assertActive(this.signal);
		this.assertPath(path);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			return await this.app.vault.readBinary(file);
		}
		return null;
	}

	/**
	 * 写入数据到本地文件 (如果存在则覆盖，如果不存在则创建)
	 */
	async write(path: string, data: ArrayBuffer): Promise<void> {
		this.assertPath(path);
		await this.mutate(path, async () => {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modifyBinary(file, data);
		} else {
			// 需要确保父目录存在
			const parentPath = path.substring(0, path.lastIndexOf('/'));
			if (parentPath && !this.app.vault.getAbstractFileByPath(parentPath)) {
				await this.ensureFolder(parentPath);
			}
			assertActive(this.signal);
			await this.app.vault.createBinary(path, data);
		}
		});
	}

    /** Compare and replace text inside Obsidian's atomic process callback. */
    async writeChecked(path: string, data: ArrayBuffer, expected: ArrayBuffer | null): Promise<void> {
        this.assertPath(path);
        await this.mutate(path, async () => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile && expected !== null) {
            const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
            let previous: string;
            let next: string;
            try { previous = decoder.decode(expected); next = decoder.decode(data); }
            catch {
                // Obsidian exposes no atomic binary compare-and-replace; caller checks and preserves versions.
                const current = new Uint8Array(await this.app.vault.readBinary(file));
                const previousBytes = new Uint8Array(expected);
                if (current.length !== previousBytes.length || current.some((byte, index) => byte !== previousBytes[index])) {
                    throw new Error(t('safety.localChanged', { path }));
                }
                await this.write(path, data);
                return;
            }
            let conflictErrorMsg: string | null = null;
            await this.app.vault.process(file, current => {
                assertActive(this.signal);
                if (current !== previous) {
                    conflictErrorMsg = t('safety.localChanged', { path });
                    return current;
                }
                return next;
            });
            if (conflictErrorMsg) throw new Error(conflictErrorMsg);
        } else {
            if (file || expected !== null) throw new Error(t('safety.localChanged', { path }));
            // createBinary rejects an existing path rather than overwriting it.
            const parent = path.substring(0, path.lastIndexOf('/'));
            if (parent) await this.ensureFolder(parent);
            assertActive(this.signal);
            await this.app.vault.createBinary(path, data);
        }
        });
    }

	/**
	 * 删除本地文件或目录
	 */
	async delete(path: string): Promise<void> {
		this.assertPath(path);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.mutate(path, () => this.app.fileManager.trashFile(file));
		} else if (file) {
			throw new Error(t('safety.localChanged', { path }));
		}
	}

	/**
	 * 获取本地文件元数据 (主要用于最后修改时间和大小)
	 */
	getMetadata(path: string): { mtime: number; size: number } | null {
		this.assertPath(path);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			return {
				mtime: file.stat.mtime,
				size: file.stat.size
			};
		}
		return null;
	}

	/**
	 * 递归创建目录
	 */
	private async ensureFolder(path: string): Promise<void> {
		const folders = path.split('/');
		let currentPath = '';

		for (const folder of folders) {
			assertActive(this.signal);
			currentPath = currentPath === '' ? folder : `${currentPath}/${folder}`;
			const abstractFile = this.app.vault.getAbstractFileByPath(currentPath);
			if (!abstractFile) {
				await this.app.vault.createFolder(currentPath);
			}
		}
	}

	private assertPath(path: string): void {
		if (!isSyncablePath(this.app, path)) throw new Error(t('safety.invalidManifest'));
	}

	private async mutate(path: string, operation: () => Promise<unknown>): Promise<void> {
		assertActive(this.signal);
		let paths = syncWrites.get(this.app);
		if (!paths) { paths = new Map(); syncWrites.set(this.app, paths); }
		paths.set(path, (paths.get(path) ?? 0) + 1);
		try { await operation(); }
		finally {
			const remaining = (paths.get(path) ?? 1) - 1;
			if (remaining) paths.set(path, remaining);
			else paths.delete(path);
		}
	}
}
