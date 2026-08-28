# Obsidian Synology Sync

[中文](README-zh.md)

> **Disclaimer**: This plugin is an independent community project and is not affiliated with, funded, or endorsed by Synology Inc.

Sync your Obsidian vault with your Synology NAS via the **Official Synology Drive API**. This plugin provides a secure and reliable way to backup and synchronize your Obsidian notes directly to your Synology Drive without relying on any third-party cloud services.

### Features
- Direct synchronization leveraging the **Official Synology WebAPI** for maximum security and native compatibility.
- Support for two-way sync, upload only, and download only modes.
- Secure connection using your Synology credentials (your credentials communicate directly with your NAS; no third-party servers are involved).
- Multi-language support (English and Chinese).

### Installation

**Primary Method: Community Plugins Store (Recommended)**
1. Open Obsidian and go to **Settings** -> **Community plugins**.
2. Turn off **Safe mode**.
3. Click **Browse** and search for `Synology Sync`.
4. Click **Install** and then enable the plugin.

*Note: If the plugin is currently in the review queue and not yet visible in the store, or if you want to try the latest beta updates, please use one of the alternative methods below.*

<details>
<summary>Alternative 1: Using BRAT (For Beta Testing)</summary>

1. Install the **Obsidian42 - BRAT** plugin from the official Community Plugins store and enable it.
2. Go to the BRAT settings and click **Add Beta plugin**.
3. Enter this repository address: `seahi/obsidian-synology-sync`
4. Enable the plugin in your Obsidian Community Plugins settings.

</details>

<details>
<summary>Alternative 2: Manual Installation</summary>

1. Go to the [Releases](../../releases/latest) page of this repository and download the latest version files (`main.js`, `manifest.json`, and `styles.css`).
2. Create a folder named `synology-sync` inside your vault's `.obsidian/plugins/` directory.
3. Place the downloaded files into the newly created folder.
4. Restart Obsidian and enable the plugin in the Community Plugins settings tab.

</details>

### Configuration
1. Go to the "Synology Sync" settings tab.
2. Enter your Synology NAS URL (e.g., `https://your-nas-ip:5001`).
3. Enter your Synology username and password.
4. Test the connection and start syncing!

### Disclaimer

**Important Notice & Trademark Disclaimer**:
- **Disclaimer**: This plugin is an independent community project and is not affiliated with, funded, or endorsed by Synology Inc. Synology, Synology Drive, and other Synology product names/logos are trademarks or registered trademarks of Synology Inc.
- This plugin is an open-source, third-party tool designed to synchronize Obsidian notes with your Synology NAS via the Synology WebAPI. By using this plugin, you acknowledge and agree to the following:

1. **Safety First**: While reasonable efforts have been made to ensure the reliability and security of this plugin, unexpected bugs, environmental differences, network fluctuations, or improper NAS configurations may result in synchronization errors, file corruption, or permanent data loss. **We strongly recommend that you make complete backups of your vault** (for example, using local copies or Synology Hyper Backup) before using this plugin, especially when running synchronization tasks.
2. **No Warranty**: The software is provided "AS IS", without warranty of any kind, express or implied. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.
3. **Data Privacy**: Your Synology account credentials and plugin configurations are saved securely on your local device only. This plugin communicates directly with your self-hosted NAS, and no data is ever transmitted to or stored on any third-party servers.

By installing or using this plugin, you acknowledge that you have read, understood, and accepted this disclaimer.
