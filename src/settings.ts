import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { ConfirmModal } from './ui/confirm-modal';
import SynologySyncPlugin from './main';
import { SynologyClient } from './api/client';
import { t } from './locales';

export interface SynologySyncSettings {
	nasUrl: string;
	username: string;
	password: string;
	otpCode: string;
	sid: string;
	syncFolder: string;
	lastSyncTime?: number;
	debugMode?: boolean;
}

export const DEFAULT_SETTINGS: SynologySyncSettings = {
	nasUrl: '',
	username: '',
	password: '',
	otpCode: '',
	sid: '',
	syncFolder: '/ObsidianSync',
	debugMode: false,
};

// @ts-expect-error TS2515: Obsidian 1.13 uses getSettingDefinitions; installed typings still require display.
export class SynologySyncSettingTab extends PluginSettingTab {
	plugin: SynologySyncPlugin;

	constructor(app: App, plugin: SynologySyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private refresh(): void {
		const update = (this as unknown as { update?: () => void }).update;
		if (typeof update === 'function') update.call(this);
	}

	getSettingDefinitions() {
		return [
			{
				type: "group",
				heading: t('settings.connection'),
				items: [
					{
						id: "nasUrl",
						name: t('settings.nasUrl.name'),
						description: t('settings.nasUrl.desc'),
						render: (setting: Setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder('HTTPS://...')
									.setValue(this.plugin.settings.nasUrl)
									.onChange(async (value) => {
										this.plugin.settings.nasUrl = value;
										await this.plugin.saveSettings();
									})
							);
						}
					},
					{
						id: "username",
						name: t('settings.username.name'),
						description: t('settings.username.desc'),
						render: (setting: Setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder('Admin')
									.setValue(this.plugin.settings.username)
									.onChange(async (value) => {
										this.plugin.settings.username = value;
										await this.plugin.saveSettings();
									})
							);
						}
					},
					{
						id: "password",
						name: t('settings.password.name'),
						description: t('settings.password.desc'),
						render: (setting: Setting) => {
							setting.addText((text) => {
								text.inputEl.type = 'password';
								text.setPlaceholder('Password')
									.setValue(this.plugin.settings.password)
									.onChange(async (value) => {
										this.plugin.settings.password = value;
										await this.plugin.saveSettings();
									});
							});
						}
					},
					{
						id: "otpCode",
						name: t('settings.otp.name'),
						description: t('settings.otp.desc'),
						render: (setting: Setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder('(Optional)')
									.setValue(this.plugin.settings.otpCode)
									.onChange(async (value) => {
										this.plugin.settings.otpCode = value;
										await this.plugin.saveSettings();
									})
							);
						}
					},
					{
						id: "syncFolder",
						name: t('settings.syncFolder.name'),
						description: t('settings.syncFolder.desc'),
						render: (setting: Setting) => {
							setting.addText((text) => {
								text
									.setPlaceholder('/obsidiansync')
									.setValue(this.plugin.settings.syncFolder)
									.onChange(async (value) => {
										this.plugin.settings.syncFolder = value;
										await this.plugin.saveSettings();
									});
								
								setting.addButton((btn) => {
									btn.setButtonText((t('settings.syncFolder.browse')) || 'Browse')
									   .onClick(async () => {
										   if (!this.plugin.settings.sid) {
											   new Notice(t('notice.loginRequired'));
											   return;
										   }
										   try {
											   const client = await this.plugin.getClient();
											   const { RemoteFolderModal } = await import('./ui/remote-folder-modal');
											   new RemoteFolderModal(this.app, client, (selectedPath) => {
												   text.setValue(selectedPath);
												   this.plugin.settings.syncFolder = selectedPath;
												   void this.plugin.saveSettings();
											   }).open();
										   } catch (e) {
											   new Notice(String(e));
										   }
									   });
								});
							});
						}
					},
					{
						id: "testConn",
						name: t('settings.testConn.name'),
						description: this.plugin.settings.sid ? t('settings.testConn.desc.hasSid') : t('settings.testConn.desc.noSid'),
						render: (setting: Setting) => {
							setting.addButton((btn) => {
								btn
									.setButtonText(this.plugin.settings.sid ? t('settings.testConn.btn.relogin') : t('settings.testConn.btn.test'))
									.setCta()
									.onClick(async () => {
										const { nasUrl, username, password, otpCode } = this.plugin.settings;
										const client = new SynologyClient(nasUrl, username, password, otpCode);
										
										try {
											btn.setDisabled(true);
											const sid = await client.login();
											// Discard a login response if the user edited its connection while awaiting the NAS.
											const current = this.plugin.settings;
											if (current.nasUrl !== nasUrl || current.username !== username || current.password !== password || current.otpCode !== otpCode) return;
											this.plugin.settings.sid = sid;
											this.plugin.settings.otpCode = ''; // 登录成功后清空一次性验证码
											await this.plugin.saveSettings();
											new Notice(t('notice.connSuccess'));
											
											this.refresh();
											void this.plugin.runEngineSync(true, true);
										} catch (err: unknown) {
											const errorMsg = err instanceof Error ? err.message : String(err);
											new Notice(t('notice.connFailed', { error: errorMsg }));
										} finally { btn.setDisabled(false); }
									});
							});
						}
					},
					{
						id: "debugMode",
						name: t('settings.debugMode.name'),
						description: t('settings.debugMode.desc'),
						render: (setting: Setting) => {
							setting.addToggle((toggle) =>
								toggle
									.setValue(this.plugin.settings.debugMode ?? false)
									.onChange(async (value) => {
										this.plugin.settings.debugMode = value;
										await this.plugin.saveSettings();
									})
							);
						}
					}
				]
			},
			{
				type: "group",
				heading: t('settings.dangerZone'),
				items: [
					{
						id: "dangerZoneDesc",
						render: (setting: Setting) => {
							setting.setDesc(t('settings.dangerZone.desc'));
						}
					},
					{
						id: "forceUpload",
						name: t('settings.forceUpload.name'),
						description: t('settings.forceUpload.desc'),
						render: (setting: Setting) => {
							setting.addButton((btn) => {
								btn.setButtonText(t('settings.forceUpload.btn'))
								   .setWarning()
								   .onClick(() => {
									   new ConfirmModal(this.app, t('settings.forceUpload.confirm'), () => {
										   void this.plugin.doForceUpload();
									   }).open();
								   });
							});
						}
					},
					{
						id: "forceDownload",
						name: t('settings.forceDownload.name'),
						description: t('settings.forceDownload.desc'),
						render: (setting: Setting) => {
							setting.addButton((btn) => {
								btn.setButtonText(t('settings.forceDownload.btn'))
								   .setWarning()
								   .onClick(() => {
									   new ConfirmModal(this.app, t('settings.forceDownload.confirm'), () => {
										   void this.plugin.doForceDownload();
									   }).open();
								   });
							});
						}
					},
					{
						id: "recoverSyncLock",
						name: t('settings.recoverLock.name'),
						description: t('settings.recoverLock.desc'),
						render: (setting: Setting) => {
							setting.addButton(btn => btn.setButtonText(t('settings.recoverLock.btn')).setWarning().onClick(() => {
								new ConfirmModal(this.app, t('settings.recoverLock.confirm'), () => this.plugin.doRecoverSyncLock()).open();
							}));
						}
					},
					{
						id: "rebuild",
						name: t('settings.rebuild.name'),
						description: t('settings.rebuild.desc'),
						render: (setting: Setting) => {
							setting.addButton((btn) => {
								btn.setButtonText(t('settings.rebuild.btn'))
								   .onClick(() => {
									   new ConfirmModal(this.app, t('settings.rebuild.confirm'), () => {
										   void this.plugin.doRebuildSyncState();
									   }).open();
								   });
							});
						}
					}
				]
			}
		];
	}
}
