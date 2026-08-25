export default {
	'plugin.name': 'Synology Sync',

	// main.ts commands & notices
	'command.uploadActive': 'Upload active file to Synology',
	'command.downloadActive': 'Download active file from Synology',
	'command.runQuick': 'Run Synology Sync (Quick)',
	'command.runFull': 'Run Synology Sync (Full)',
	'command.showLog': 'Show Synology Sync Log',

	'notice.noActiveFile': 'No active file',
	'notice.loginRequired': 'Please login to Synology Drive in settings first',
	'notice.uploading': 'Uploading to: {{targetPath}}',
	'notice.uploadSuccess': 'Upload successful!',
	'notice.uploadFailed': 'Upload failed: {{error}}',
	'notice.noActiveFileToDefine': 'No active file to define path',
	'notice.downloading': 'Downloading from Synology: {{targetPath}}',
	'notice.downloadSuccess': 'Downloaded and overwritten successfully!',
	'notice.downloadFailed': 'Download failed: {{error}}',
	
	'status.standby': 'NAS: Standby',
	'status.standbyWithTime': 'NAS: Standby ({{time}})',
	'status.syncing': 'NAS: Syncing...',
	'status.synced': 'NAS: Synced',
	'status.error': 'NAS: Error',
	'status.forceUploading': 'NAS: Force uploading...',
	'status.forceDownloading': 'NAS: Force downloading...',
	'status.rebuilding': 'NAS: Rebuilding baseline...',

	'notice.syncException': 'Sync exception: {{error}}',
	'notice.nasParamsMissing': 'NAS parameters not configured or not logged in',
	'notice.forceUploadSuccess': 'Force full upload complete',
	'notice.forceUploadFailed': 'Force upload failed: {{error}}',
	'notice.forceDownloadSuccess': 'Force full download complete',
	'notice.forceDownloadFailed': 'Force download failed: {{error}}',
	'notice.rebuildSuccess': 'Sync baseline rebuild complete',
	'notice.rebuildFailed': 'Rebuild baseline failed: {{error}}',

	// settings.ts
	'settings.nasUrl.name': 'NAS Address (URL)',
	'settings.nasUrl.desc': 'e.g., https://nas.example.com:5001',
	'settings.username.name': 'Username',
	'settings.username.desc': 'Synology account username',
	'settings.password.name': 'Password',
	'settings.password.desc': 'Synology account password',
	'settings.otp.name': '2FA Code (OTP)',
	'settings.otp.desc': 'Cleared automatically after successful verification. Required only when Session expires or logging in for the first time.',
	'settings.syncFolder.name': 'Sync Folder',
	'settings.syncFolder.desc': 'Target sync folder on Synology, must exist (e.g., /home/Drive/ObsidianSync)',
	
	'settings.testConn.name': 'Test Connection & Login',
	'settings.testConn.desc.hasSid': 'Currently has authorized session (SID)',
	'settings.testConn.desc.noSid': 'Currently unauthorized, please click login to get session',
	'settings.testConn.btn.relogin': 'Re-login',
	'settings.testConn.btn.test': 'Test Connection',
	'notice.connSuccess': 'Connection and login successful',
	'notice.connFailed': 'Connection failed: {{error}}',

	'settings.dangerZone': 'Danger Zone / Initial Setup',
	'settings.forceUpload.name': 'Force Full Upload (Overwrite Synology)',
	'settings.forceUpload.desc': 'Local takes precedence. Force clear remote extra files and push all local notes to Synology.',
	'settings.forceUpload.btn': 'Force Upload',
	'settings.forceUpload.confirm': 'Warning: This will completely overwrite and reset the sync directory on Synology using local files. Are you sure you want to proceed?',

	'settings.forceDownload.name': 'Force Full Download (Overwrite Local)',
	'settings.forceDownload.desc': 'Synology takes precedence. Force clear local extra files and pull all Synology notes to local.',
	'settings.forceDownload.btn': 'Force Download',
	'settings.forceDownload.confirm': 'Warning: This will clear local extra files and completely overwrite the local vault using Synology files. Are you sure you want to proceed?',

	'settings.rebuild.name': 'Rebuild Sync Baseline (Rebuild State)',
	'settings.rebuild.desc': 'Suitable for scenarios manually copied via USB drive. Clear existing sync state, re-compare Hash and generate new sync baseline.',
	'settings.rebuild.btn': 'Rebuild State',
	'settings.rebuild.confirm': 'Are you sure you want to forcefully rebuild the sync state snapshot?',

	// engine.ts
	'notice.engine.syncing': 'Syncing...',

	// ui/sync-log-modal.ts
	'ui.logModal.title': 'Synology Sync Log',
	'ui.logModal.empty': 'No sync records available.',
};
