import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
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
}

export const DEFAULT_SETTINGS: SynologySyncSettings = {
	nasUrl: '',
	username: '',
	password: '',
	otpCode: '',
	sid: '',
	syncFolder: '/ObsidianSync',
};

export class SynologySyncSettingTab extends PluginSettingTab {
	plugin: SynologySyncPlugin;

	constructor(app: App, plugin: SynologySyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName(t('settings.nasUrl.name'))
			.setDesc(t('settings.nasUrl.desc'))
			.addText((text) =>
				text
					.setPlaceholder('https://...')
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
					.setPlaceholder('admin')
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
				text.setPlaceholder('password')
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
					.setPlaceholder('123456')
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
					.setPlaceholder('/ObsidianSync')
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
						} catch (err: any) {
							new Notice(t('notice.connFailed', { error: err.message }));
						}
					});
			});

		containerEl.createEl('h3', { text: t('settings.dangerZone'), cls: 'setting-item-heading' });
		
		new Setting(containerEl)
			.setName(t('settings.forceUpload.name'))
			.setDesc(t('settings.forceUpload.desc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.forceUpload.btn'))
				   .setWarning()
				   .onClick(async () => {
					   if (confirm(t('settings.forceUpload.confirm'))) {
						   await this.plugin.doForceUpload();
					   }
				   });
			});

		new Setting(containerEl)
			.setName(t('settings.forceDownload.name'))
			.setDesc(t('settings.forceDownload.desc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.forceDownload.btn'))
				   .setWarning()
				   .onClick(async () => {
					   if (confirm(t('settings.forceDownload.confirm'))) {
						   await this.plugin.doForceDownload();
					   }
				   });
			});

		new Setting(containerEl)
			.setName(t('settings.rebuild.name'))
			.setDesc(t('settings.rebuild.desc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.rebuild.btn'))
				   .onClick(async () => {
					   if (confirm(t('settings.rebuild.confirm'))) {
						   await this.plugin.doRebuildSyncState();
					   }
				   });
			});
	}
}
