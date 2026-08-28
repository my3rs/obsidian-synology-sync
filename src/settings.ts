import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
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
			{ id: "nasUrl", name: t('settings.nasUrl.name'), description: t('settings.nasUrl.desc'), type: "text" },
			{ id: "username", name: t('settings.username.name'), description: t('settings.username.desc'), type: "text" },
			{ id: "password", name: t('settings.password.name'), description: t('settings.password.desc'), type: "text" },
			{ id: "otpCode", name: t('settings.otp.name'), description: t('settings.otp.desc'), type: "text" },
			{ id: "syncFolder", name: t('settings.syncFolder.name'), description: t('settings.syncFolder.desc'), type: "text" },
			{ id: "testConn", name: t('settings.testConn.name'), description: this.plugin.settings.sid ? t('settings.testConn.desc.hasSid') : t('settings.testConn.desc.noSid'), type: "button" },
			{ id: "forceUpload", name: t('settings.forceUpload.name'), description: t('settings.forceUpload.desc'), type: "button" },
			{ id: "forceDownload", name: t('settings.forceDownload.name'), description: t('settings.forceDownload.desc'), type: "button" },
			{ id: "rebuild", name: t('settings.rebuild.name'), description: t('settings.rebuild.desc'), type: "button" }
		];
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName(t('settings.nasUrl.name'))
			.setDesc(t('settings.nasUrl.desc'))
			.addText((text) =>
				text
					.setPlaceholder('HTTPS://...')
					.setValue(this.plugin.settings.nasUrl)
					.onChange(async (value) => {
						this.plugin.settings.nasUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.username.name'))
			.setDesc(t('settings.username.desc'))
			.addText((text) =>
				text
					.setPlaceholder('Admin')
					.setValue(this.plugin.settings.username)
					.onChange(async (value) => {
						this.plugin.settings.username = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.password.name'))
			.setDesc(t('settings.password.desc'))
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder('Password')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.otp.name'))
			.setDesc(t('settings.otp.desc'))
			.addText((text) =>
				text
					.setPlaceholder('(Optional)')
					.setValue(this.plugin.settings.otpCode)
					.onChange(async (value) => {
						this.plugin.settings.otpCode = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.syncFolder.name'))
			.setDesc(t('settings.syncFolder.desc'))
			.addText((text) =>
				text
					.setPlaceholder('/obsidiansync')
					.setValue(this.plugin.settings.syncFolder)
					.onChange(async (value) => {
						this.plugin.settings.syncFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.testConn.name'))
			.setDesc(this.plugin.settings.sid ? t('settings.testConn.desc.hasSid') : t('settings.testConn.desc.noSid'))
			.addButton((btn) => {
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
							this.display(); // 刷新 UI
						} catch (err: unknown) {
							const errorMsg = err instanceof Error ? err.message : String(err);
							new Notice(t('notice.connFailed', { error: errorMsg }));
						}
					});
			});

		new Setting(containerEl).setName("").setHeading();
		
		new Setting(containerEl)
			.setName(t('settings.forceUpload.name'))
			.setDesc(t('settings.forceUpload.desc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.forceUpload.btn'))
				   .setWarning()
				   .onClick(() => {
					   new ConfirmModal(this.app, t('settings.forceUpload.confirm'), () => {
						   void this.plugin.doForceUpload();
					   }).open();
				   });
			});

		new Setting(containerEl)
			.setName(t('settings.forceDownload.name'))
			.setDesc(t('settings.forceDownload.desc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.forceDownload.btn'))
				   .setWarning()
				   .onClick(() => {
					   new ConfirmModal(this.app, t('settings.forceDownload.confirm'), () => {
						   void this.plugin.doForceDownload();
					   }).open();
				   });
			});

		new Setting(containerEl)
			.setName(t('settings.rebuild.name'))
			.setDesc(t('settings.rebuild.desc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.rebuild.btn'))
				   .onClick(() => {
					   new ConfirmModal(this.app, t('settings.rebuild.confirm'), () => {
						   void this.plugin.doRebuildSyncState();
					   }).open();
				   });
			});
	}
}
