import { Plugin, setIcon, setTooltip, TAbstractFile, TFile } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	SynologySyncSettings,
	SynologySyncSettingTab,
} from './settings';
import { t } from './locales';
import { SyncController, SyncUIState } from './sync/controller';
import { ConfirmModal } from './ui/confirm-modal';
import { syncTarget } from './sync/remote-access';


import type { SyncLogger } from './sync/logger';
export default class SynologySyncPlugin extends Plugin {
	private controller = new SyncController(this);
	private settingsSave: Promise<void> = Promise.resolve();
	settings!: SynologySyncSettings;
	public logger!: SyncLogger;
	private statusBarItem!: HTMLElement;
	updateStatusBar(state: SyncUIState) {
		if (!this.statusBarItem) return;
		this.statusBarItem.empty();
		let iconName = 'cloud';
		let tooltipText = '';

		switch (state) {
			case 'idle':
				iconName = this.settings.lastSyncTime ? 'check-circle' : 'cloud';
				if (this.settings.lastSyncTime) {
					const date = new Date(this.settings.lastSyncTime);
					const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
					tooltipText = t('status.standbyWithTime', { time: timeStr });
				} else {
					tooltipText = t('status.standby');
				}
				break;
			case 'syncing':
				iconName = 'refresh-cw';
				tooltipText = t('status.syncing');
				break;
			case 'force-uploading':
				iconName = 'upload-cloud';
				tooltipText = t('status.forceUploading');
				break;
			case 'force-downloading':
				iconName = 'download-cloud';
				tooltipText = t('status.forceDownloading');
				break;
			case 'rebuilding':
				iconName = 'database';
				tooltipText = t('status.rebuilding');
				break;
			case 'error':
				iconName = 'alert-triangle';
				tooltipText = t('status.error');
				break;
		}

		setIcon(this.statusBarItem, iconName);
		setTooltip(this.statusBarItem, tooltipText, { placement: 'top' });
	}

	async onload() {
		await this.loadSettings();
		this.controller.initialize();
		
		
		const { SyncLogger } = await import('./sync/logger');
		this.logger = new SyncLogger(this.app, this.manifest.dir!);

		// 添加设置面板
		this.addSettingTab(new SynologySyncSettingTab(this.app, this));

		// 测试命令：将当前打开的文件上传到群晖
		this.addCommand({
			id: 'upload-active',
			name: t('command.uploadActive'),
			callback: async () => {
				await this.uploadActiveFile();
			}
		});

		// 测试命令：从群晖下载当前路径的文件并覆盖本地
		this.addCommand({
			id: 'download-active',
			name: t('command.downloadActive'),
			callback: async () => {
				await this.downloadActiveFile();
			}
		});

		const { SyncStatusView, VIEW_TYPE_SYNC_STATUS } = await import('./ui/sync-status-view');
		this.registerView(
			VIEW_TYPE_SYNC_STATUS,
			(leaf) => new SyncStatusView(leaf, this)
		);

		this.addCommand({
			id: 'toggle-sync-status-view',
			name: t('command.toggleStatusView'),
			callback: () => {
				void this.toggleSyncStatusView();
			}
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item
							.setTitle(t('command.toggleStatusView'))
							.setIcon('cloud')
							.onClick(() => {
								void this.toggleSyncStatusView();
							});
					});
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu) => {
				menu.addItem((item) => {
					item
						.setTitle(t('command.toggleStatusView'))
						.setIcon('cloud')
						.onClick(() => {
							void this.toggleSyncStatusView();
						});
				});
			})
		);


		// 添加状态栏提示
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.classList.add('mod-clickable');
		this.updateStatusBar('idle');
		this.registerDomEvent(this.statusBarItem, 'click', () => {
			void this.runEngineSync(false, true);
		});
		
		const ribbonIconEl = this.addRibbonIcon('refresh-cw', t('plugin.name'), (evt: MouseEvent) => {
			void this.runEngineSync(false, true);
		});
		if (ribbonIconEl.parentNode) {
			ribbonIconEl.parentNode.insertBefore(ribbonIconEl, ribbonIconEl.parentNode.firstChild);
		}


		// 监听本地文件变更，防抖触发同步 (3秒)
		this.registerEvent(this.app.vault.on('modify', (file) => this.triggerAutoSync(file)));
		this.registerEvent(this.app.vault.on('create', (file) => this.triggerAutoSync(file)));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.controller.fileChanged(file, file.path);
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.controller.fileChanged(file, oldPath);
		}));

		// 定时轮询远端变更 (每 30 秒一次 Quick Sync)
		this.registerInterval(
			window.setInterval(() => {
				void this.runEngineSync(false);
			}, 30 * 1000)
		);

		// 等待库布局就绪后执行全量核验，避免固定延迟与启动扫描竞争。
		this.app.workspace.onLayoutReady(() => {
			this.controller.layoutReady();
		});
		
		// 同步引擎命令
		this.addCommand({
			id: 'run',
			name: t('command.runQuick'),
			callback: async () => {
				await this.runEngineSync(false, true);
			}
		});

		this.addCommand({
			id: 'run-full',
			name: t('command.runFull'),
			callback: async () => {
				await this.runEngineSync(true, true);
			}
		});

		this.addCommand({
			id: 'recover-sync-lock',
			name: t('command.recoverSyncLock'),
			callback: () => {
				new ConfirmModal(this.app, t('settings.recoverLock.confirm'), () => this.doRecoverSyncLock()).open();
			}
		});

		this.addCommand({
			id: 'show-log',
			name: t('command.showLog'),
			callback: async () => {
				const { SyncLogModal } = await import('./ui/sync-log-modal');
				new SyncLogModal(this.app, this.logger).open();
			}
		});
	}

	async toggleSyncStatusView() {
		const { VIEW_TYPE_SYNC_STATUS } = await import('./ui/sync-status-view');
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SYNC_STATUS);
		if (leaves.length > 0) {
			this.app.workspace.detachLeavesOfType(VIEW_TYPE_SYNC_STATUS);
		} else {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_SYNC_STATUS, active: true });
				void this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	triggerAutoSync(file?: TAbstractFile) {
		this.controller.fileChanged(file);
	}

	async getClient() {
		const { nasUrl, username, password, otpCode, sid } = this.settings;
		const { SynologyClient } = await import('./api/client');
		const client = new SynologyClient(nasUrl, username, password, otpCode);
		client.debugMode = this.settings.debugMode ?? false;
		if (sid) (client as unknown as { sid: string }).sid = sid;
		return client;
	}

	async getEngine(signal?: AbortSignal) {
		const { nasUrl, username, password, otpCode, sid, syncFolder } = this.settings;
		if (!sid || !syncFolder) {
			throw new Error(t('notice.nasParamsMissing'));
		}

		const { SynologyClient } = await import('./api/client');
		const { SyncEngine } = await import('./sync/engine');
		const { SyncState } = await import('./sync/state');

		const client = new SynologyClient(nasUrl, username, password, otpCode);
		client.debugMode = this.settings.debugMode ?? false;
		(client as unknown as { sid: string }).sid = sid;

		const target = syncTarget(nasUrl, username, syncFolder);
		const state = new SyncState(this.app, this.manifest.dir!, target);
		return new SyncEngine(this.app, client, state, this.logger, syncFolder, this.controller.deletions, signal);
	}

	async runEngineSync(fullScan: boolean, showNotice = false) {
		await this.controller.runSync(fullScan, showNotice);
	}

	onunload() { this.controller.dispose(); }

	async doForceUpload() { await this.controller.forceUpload(); }
	async doForceDownload() { await this.controller.forceDownload(); }
	async doRebuildSyncState() { await this.controller.rebuild(); }
	async doRecoverSyncLock() { await this.controller.recoverLock(); }
	async uploadActiveFile() { await this.controller.transferActiveFile('upload'); }
	async downloadActiveFile() { await this.controller.transferActiveFile('download'); }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SynologySyncSettings>,
		);
	}

	async saveSettings() {
		this.controller.settingsChanged();
		const snapshot = { ...this.settings };
		const save = this.settingsSave.then(() => this.saveData(snapshot));
		this.settingsSave = save.catch(() => {});
		await save;
	}
}
