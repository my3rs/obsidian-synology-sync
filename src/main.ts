import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	SynologySyncSettings,
	SynologySyncSettingTab,
} from './settings';

export default class SynologySyncPlugin extends Plugin {
	settings!: SynologySyncSettings;

	async onload() {
		await this.loadSettings();

		// 添加设置面板
		this.addSettingTab(new SynologySyncSettingTab(this.app, this));
	}

	onunload() {
		// 插件卸载时的清理逻辑
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
