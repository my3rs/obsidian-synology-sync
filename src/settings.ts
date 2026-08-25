import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import SynologySyncPlugin from './main';
import { SynologyClient } from './api/client';

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
			.setName('NAS Address (URL)')
			.setDesc('例如: https://nas.example.com:5001')
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
			.setName('Username')
			.setDesc('群晖账号用户名')
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
			.setName('Password')
			.setDesc('群晖账号密码')
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
			.setName('2FA 验证码 (OTP)')
			.setDesc('验证成功后会自动清空。仅当 Session 过期或首次登录时需要。')
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
			.setName('Sync Folder')
			.setDesc('群晖上的同步目标文件夹，必须存在 (例如: /home/Drive/ObsidianSync)')
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
			.setName('Test Connection & Login')
			.setDesc(this.plugin.settings.sid ? '当前已有授权会话 (SID)' : '当前未授权，请点击登录获取会话')
			.addButton((btn) => {
				btn
					.setButtonText(this.plugin.settings.sid ? '重新登录' : '测试连接')
					.setCta()
					.onClick(async () => {
						const { nasUrl, username, password, otpCode } = this.plugin.settings;
						const client = new SynologyClient(nasUrl, username, password, otpCode);
						
						try {
							const sid = await client.login();
							this.plugin.settings.sid = sid;
							this.plugin.settings.otpCode = ''; // 登录成功后清空一次性验证码
							await this.plugin.saveSettings();
							new Notice('连接并登录成功');
							this.display(); // 刷新 UI
						} catch (err: any) {
							new Notice('连接失败: ' + err.message);
						}
					});
			});

		containerEl.createEl('h3', { text: '危险操作 (Danger Zone) / 首次初始化', cls: 'setting-item-heading' });
		
		new Setting(containerEl)
			.setName('强制全量上传 (覆盖群晖)')
			.setDesc('以本地为准。强制清空远端额外文件，并将本地所有笔记推送到群晖。')
			.addButton((btn) => {
				btn.setButtonText('Force Upload')
				   .setWarning()
				   .onClick(async () => {
					   if (confirm('警告：这会使用本地文件完全覆盖并重置群晖上的同步目录，您确定要执行吗？')) {
						   await this.plugin.doForceUpload();
					   }
				   });
			});

		new Setting(containerEl)
			.setName('强制全量下载 (覆盖本地)')
			.setDesc('以群晖为准。强制清空本地额外文件，并将群晖所有笔记拉取到本地。')
			.addButton((btn) => {
				btn.setButtonText('Force Download')
				   .setWarning()
				   .onClick(async () => {
					   if (confirm('警告：这会清空本地额外文件，并使用群晖文件完全覆盖本地库，您确定要执行吗？')) {
						   await this.plugin.doForceDownload();
					   }
				   });
			});

		new Setting(containerEl)
			.setName('构建同步基准 (重建状态)')
			.setDesc('适合已通过U盘手动拷贝的场景。清空现有同步状态，重新比对Hash并生成新的同步基准。')
			.addButton((btn) => {
				btn.setButtonText('Rebuild State')
				   .onClick(async () => {
					   if (confirm('确认要强制重建同步状态快照吗？')) {
						   await this.plugin.doRebuildSyncState();
					   }
				   });
			});
	}
}
