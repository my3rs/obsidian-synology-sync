import { App, Modal, Notice, PluginSettingTab, Setting, Platform } from 'obsidian';
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
}

export const DEFAULT_SETTINGS: SynologySyncSettings = {
	nasUrl: '',
	username: '',
	password: '',
	otpCode: '',
	sid: '',
	syncFolder: '/ObsidianSync',
};

class ConfirmModal extends Modal {
	message: string;
	onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(this.message);
		
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Cancel')
					.onClick(() => {
						this.close();
					}))
			.addButton((btn) =>
				btn
					.setButtonText('Confirm')
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}


export class SynologySyncSettingTab extends PluginSettingTab {
	plugin: SynologySyncPlugin;

	constructor(app: App, plugin: SynologySyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}


	// @ts-ignore: To support Obsidian 1.13+ setting search capabilities
	getSettingDefinitions() {
		return [
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
					setting.addText((text) =>
						text
							.setPlaceholder('/obsidiansync')
							.setValue(this.plugin.settings.syncFolder)
							.onChange(async (value) => {
								this.plugin.settings.syncFolder = value;
								await this.plugin.saveSettings();
							})
					);
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
									const sid = await client.login();
									this.plugin.settings.sid = sid;
									this.plugin.settings.otpCode = ''; // 登录成功后清空一次性验证码
									await this.plugin.saveSettings();
									new Notice(t('notice.connSuccess'));
									
									// 强制刷新设置界面
									// 由于我们现在完全在 getSettingDefinitions 内部，调用 this.display() 可能不足够触发重新渲染。
									// 对于原生的 PluginSettingTab，重绘需要调用 app.setting.openTabById 等方法，或者手动重置 containerEl。
									// 在 Obsidian 内部，由于无法轻松直接 trigger 重新渲染 declarative list，
									// 我们可以利用 display() 清空并重新构建（如果是兼容模式），
									// 针对 declarative mode，我们可以在 display() 中显式清理并重新调用。
									this.display(); 
								} catch (err: unknown) {
									const errorMsg = err instanceof Error ? err.message : String(err);
									new Notice(t('notice.connFailed', { error: errorMsg }));
								}
							});
					});
				}
			},
			{
				id: "dangerZoneHeading",
				name: "",
				description: "",
				render: (setting: Setting) => {
					setting.setHeading();
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
		];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// 由于我们迁移到了声明式配置 getSettingDefinitions()
		// 为了防止部分 Obsidian 旧版本（或某些情况下）不自动渲染，
		// 我们在这里手动遍历 definitions 并调用 render。
		// 如果 Obsidian 内部已经接管并自动调用了，这会作为一个保底渲染。
		// 在 Obsidian 1.13+ 如果它原生接管，它可能会在某些视图下跳过执行自定义的 display()，
		// 但为了保险起见，以及响应 "Test Connection" 按钮点击后的 UI 刷新，
		// 我们可以利用 display() 手动绘制一次。
		
		const defs = this.getSettingDefinitions();
		for (const def of defs) {
			const setting = new Setting(containerEl);
			if (def.name) setting.setName(def.name);
			if (def.description) setting.setDesc(def.description);
			if (def.render) {
				def.render(setting);
			}
		}
	}
}
