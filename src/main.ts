import { Notice, Plugin, arrayBufferToBase64 } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	SynologySyncSettings,
	SynologySyncSettingTab,
} from './settings';
import { t } from './locales';

import type { SyncLogger } from './sync/logger';

export default class SynologySyncPlugin extends Plugin {
	settings!: SynologySyncSettings;
	public logger!: SyncLogger;
	private statusBarItem!: HTMLElement;
	private syncTimeout: NodeJS.Timeout | null = null;
	private isSyncing: boolean = false;
	private lastSyncSuccessTime: number | null = null;

	async onload() {
		await this.loadSettings();
		
		const { SyncLogger } = await import('./sync/logger');
		this.logger = new SyncLogger(this.app, this.manifest.dir!);

		// 添加设置面板
		this.addSettingTab(new SynologySyncSettingTab(this.app, this));

		// 测试命令：将当前打开的文件上传到群晖
		this.addCommand({
			id: 'synology-sync-upload-active',
			name: t('command.uploadActive'),
			callback: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice(t('notice.noActiveFile'));
					return;
				}

				let notice: Notice | null = null;
				try {
					const { SynologyClient } = await import('./api/client');
					const { nasUrl, username, password, sid, syncFolder } = this.settings;
					if (!sid) {
						new Notice(t('notice.loginRequired'));
						return;
					}

					const client = new SynologyClient(nasUrl, username, password);
					(client as any).sid = sid; // 注入现有的 sid

					// 读取文件内容为二进制并转为 Base64
					const buffer = await this.app.vault.readBinary(activeFile);
					const base64Content = arrayBufferToBase64(buffer);

					let targetPath = `${syncFolder}/${activeFile.path}`;
					if (!targetPath.startsWith('/mydrive/') && !targetPath.startsWith('/team-folders/')) {
						targetPath = `/mydrive${targetPath.startsWith('/') ? '' : '/'}${targetPath}`;
					}
					// 移除可能存在的双斜杠
					targetPath = targetPath.replace(/\/\//g, '/');

					const n = new Notice(t('notice.uploading', { targetPath }), 0);
					notice = n;
					await client.uploadFileBase64(targetPath, base64Content);
					n.setMessage(t('notice.uploadSuccess'));
					setTimeout(() => n.hide(), 3000);
				} catch (err: any) {
					const n = notice;
					if (n) {
						n.setMessage(t('notice.uploadFailed', { error: err.message }));
						setTimeout(() => n.hide(), 5000);
					} else {
						new Notice(t('notice.uploadFailed', { error: err.message }));
					}
					console.error(err);
				}
			}
		});

		// 测试命令：从群晖下载当前路径的文件并覆盖本地
		this.addCommand({
			id: 'synology-sync-download-active',
			name: t('command.downloadActive'),
			callback: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice(t('notice.noActiveFileToDefine'));
					return;
				}

				let notice: Notice | null = null;
				try {
					const { SynologyClient } = await import('./api/client');
					const { LocalFS } = await import('./fs/local');
					const { nasUrl, username, password, sid, syncFolder } = this.settings;
					if (!sid) {
						new Notice(t('notice.loginRequired'));
						return;
					}

					const client = new SynologyClient(nasUrl, username, password);
					(client as any).sid = sid;

					let targetPath = `${syncFolder}/${activeFile.path}`;
					if (!targetPath.startsWith('/mydrive/') && !targetPath.startsWith('/team-folders/')) {
						targetPath = `/mydrive${targetPath.startsWith('/') ? '' : '/'}${targetPath}`;
					}
					targetPath = targetPath.replace(/\/\//g, '/');

					const n = new Notice(t('notice.downloading', { targetPath }), 0);
					notice = n;
					const buffer = await client.downloadFile(targetPath);
					const localFs = new LocalFS(this.app);
					await localFs.write(activeFile.path, buffer);
					
					n.setMessage(t('notice.downloadSuccess'));
					setTimeout(() => n.hide(), 3000);
				} catch (err: any) {
					const n = notice;
					if (n) {
						n.setMessage(t('notice.downloadFailed', { error: err.message }));
						setTimeout(() => n.hide(), 5000);
					} else {
						new Notice(t('notice.downloadFailed', { error: err.message }));
					}
					console.error(err);
				}
			}
		});

		// 添加状态栏提示
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText(t('status.standby'));
		this.statusBarItem.onClickEvent(() => {
			this.runEngineSync(false);
		});

		// 监听本地文件变更，防抖触发同步 (3秒)
		this.registerEvent(this.app.vault.on('modify', (file) => this.triggerAutoSync(file)));
		this.registerEvent(this.app.vault.on('create', (file) => this.triggerAutoSync(file)));
		this.registerEvent(this.app.vault.on('delete', (file) => this.triggerAutoSync(file)));
		this.registerEvent(this.app.vault.on('rename', (file) => this.triggerAutoSync(file)));

		// 定时轮询远端变更 (每 30 秒一次 Quick Sync)
		this.registerInterval(
			window.setInterval(() => {
				this.runEngineSync(false);
			}, 30 * 1000)
		);

		// 启动时执行一次全量同步 (Full Sync) 探测远端删除，为了不阻塞，延迟执行
		setTimeout(() => {
			this.runEngineSync(true);
		}, 2000);

		// 同步引擎命令
		this.addCommand({
			id: 'synology-sync-run',
			name: t('command.runQuick'),
			callback: async () => {
				await this.runEngineSync(false);
			}
		});

		this.addCommand({
			id: 'synology-sync-run-full',
			name: t('command.runFull'),
			callback: async () => {
				await this.runEngineSync(true);
			}
		});

		this.addCommand({
			id: 'synology-sync-show-log',
			name: t('command.showLog'),
			callback: async () => {
				const { SyncLogModal } = await import('./ui/sync-log-modal');
				new SyncLogModal(this.app, this.logger).open();
			}
		});
	}

	triggerAutoSync(file?: any) {
		// 忽略 Obsidian 自身的配置和插件产生的变更（比如我们自己的 sync_data.json），否则会陷入无限循环同步
		if (file && file.path && file.path.startsWith('.obsidian/')) {
			return;
		}

		if (this.syncTimeout) {
			clearTimeout(this.syncTimeout);
		}
		this.syncTimeout = setTimeout(() => {
			this.runEngineSync(false);
		}, 3000); // 停止打字 3 秒后自动同步
	}

	private async getEngine() {
		const { nasUrl, username, password, otpCode, sid, syncFolder } = this.settings;
		if (!sid || !syncFolder) {
			throw new Error(t('notice.nasParamsMissing'));
		}

		const { SynologyClient } = await import('./api/client');
		const { SyncEngine } = await import('./sync/engine');
		const { SyncState } = await import('./sync/state');

		const client = new SynologyClient(nasUrl, username, password, otpCode);
		(client as any).sid = sid;

		const state = new SyncState(this.app, this.manifest.dir!);
		return new SyncEngine(this.app, client, state, this.logger, syncFolder);
	}

	async runEngineSync(fullScan: boolean) {
		if (this.isSyncing) return;
		
		try {
			this.isSyncing = true;
			this.statusBarItem.setText(t('status.syncing'));
			
			const engine = await this.getEngine();
			const hasChanges = await engine.runSync(fullScan);
			
			if (hasChanges) {
				this.lastSyncSuccessTime = Date.now();
				this.statusBarItem.setText(t('status.synced'));
				// 3秒后恢复待命状态
				setTimeout(() => {
					if (!this.isSyncing) this.updateStatusBarIdle();
				}, 3000);
			} else {
				this.updateStatusBarIdle();
			}
		} catch (err: any) {
			this.statusBarItem.setText(t('status.error'));
			new Notice(t('notice.syncException', { error: err.message }));
			console.error(err);
		} finally {
			this.isSyncing = false;
		}
	}

	private updateStatusBarIdle() {
		if (this.lastSyncSuccessTime) {
			const date = new Date(this.lastSyncSuccessTime);
			const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
			this.statusBarItem.setText(t('status.standbyWithTime', { time: timeStr }));
		} else {
			this.statusBarItem.setText(t('status.standby'));
		}
	}

	onunload() {
		// 插件卸载时的清理逻辑
	}

	async doForceUpload() {
		if (this.isSyncing) return;
		try {
			this.isSyncing = true;
			this.statusBarItem.setText(t('status.forceUploading'));
			const engine = await this.getEngine();
			await engine.forceUpload();
			this.lastSyncSuccessTime = Date.now();
			new Notice(t('notice.forceUploadSuccess'));
		} catch (e: any) {
			new Notice(t('notice.forceUploadFailed', { error: e.message }));
		} finally {
			this.isSyncing = false;
			this.updateStatusBarIdle();
		}
	}

	async doForceDownload() {
		if (this.isSyncing) return;
		try {
			this.isSyncing = true;
			this.statusBarItem.setText(t('status.forceDownloading'));
			const engine = await this.getEngine();
			await engine.forceDownload();
			this.lastSyncSuccessTime = Date.now();
			new Notice(t('notice.forceDownloadSuccess'));
		} catch (e: any) {
			new Notice(t('notice.forceDownloadFailed', { error: e.message }));
		} finally {
			this.isSyncing = false;
			this.updateStatusBarIdle();
		}
	}

	async doRebuildSyncState() {
		if (this.isSyncing) return;
		try {
			this.isSyncing = true;
			this.statusBarItem.setText(t('status.rebuilding'));
			const engine = await this.getEngine();
			await engine.rebuildSyncState();
			this.lastSyncSuccessTime = Date.now();
			new Notice(t('notice.rebuildSuccess'));
		} catch (e: any) {
			new Notice(t('notice.rebuildFailed', { error: e.message }));
		} finally {
			this.isSyncing = false;
			this.updateStatusBarIdle();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SynologySyncSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
