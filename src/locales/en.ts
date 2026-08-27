export default {
	'plugin.name': 'Synology Sync',

	'command.uploadActive': 'Upload Active File to NAS',
	'command.downloadActive': 'Download & Overwrite Active File',
	'command.runQuick': 'Run Synology Sync (Quick)',
	'command.runFull': 'Run Synology Sync (Full)',
	'command.showLog': 'Show Sync Logs',


	'notice.noActiveFile': 'No active file selected',
	'notice.loginRequired': 'Please login to Synology Drive in settings first',
	'notice.uploading': 'Uploading to: {{targetPath}}',
	'notice.uploadSuccess': 'Upload success!',
	'notice.uploadFailed': 'Upload failed: {{error}}',
	'notice.noActiveFileToDefine': 'No active file to determine path',
	'notice.downloading': 'Downloading from NAS: {{targetPath}}',
	'notice.downloadSuccess': 'Download & Overwrite success!',
	'notice.downloadFailed': 'Download failed: {{error}}',
	
	'status.standby': 'Click to sync',
	'status.standbyWithTime': 'Last synced: {{time}}',
	'status.syncing': 'NAS: Syncing...',
	'status.error': 'NAS: Error',
	'status.forceUploading': 'NAS: Force Uploading...',
	'status.forceDownloading': 'NAS: Force Downloading...',
	'status.rebuilding': 'NAS: Rebuilding Base...',

	'notice.syncException': 'Sync Exception: {{error}}',
	'notice.nasParamsMissing': 'NAS parameters missing or not logged in',
	'notice.forceUploadSuccess': 'Force Full Upload Completed',
	'notice.forceUploadFailed': 'Force Upload Failed: {{error}}',
	'notice.forceDownloadSuccess': 'Force Full Download Completed',
	'notice.forceDownloadFailed': 'Force Download Failed: {{error}}',
	'notice.rebuildSuccess': 'Sync Base Rebuild Completed',
	'notice.rebuildFailed': 'Rebuild Base Failed: {{error}}',

	'settings.nasUrl.name': 'NAS Address (URL)',
	'settings.nasUrl.desc': 'e.g., https://nas.example.com:5001',
	'settings.username.name': 'Username',
	'settings.username.desc': 'Synology account username',
	'settings.password.name': 'Password',
	'settings.password.desc': 'Synology account password',
	'settings.otp.name': '2FA OTP Code',
	'settings.otp.desc': 'Cleared automatically on success. Only needed if Session expired or for first login.',
	'settings.syncFolder.name': 'Target Sync Folder',
	'settings.syncFolder.desc': 'Sync target folder on NAS (must exist), e.g., /home/Drive/ObsidianSync',
	
	'settings.testConn.name': 'Test Connection & Login',
	'settings.testConn.desc.hasSid': 'Authorized session alive (SID)',
	'settings.testConn.desc.noSid': 'Not authorized, please click to login',
	'settings.testConn.btn.relogin': 'Re-login',
	'settings.testConn.btn.test': 'Test Connection',
	'notice.connSuccess': 'Connection & Login Successful',
	'notice.connFailed': 'Connection Failed: {{error}}',

	'settings.dangerZone': 'Danger Zone / First-time Init',
	'settings.forceUpload.name': 'Force Full Upload (Overwrite NAS)',
	'settings.forceUpload.desc': 'Local truth. Voids remote extra files, pushes all local notes to NAS.',
	'settings.forceUpload.btn': 'Force Upload',
	'settings.forceUpload.confirm': 'WARNING: This will completely overwrite and reset the NAS sync folder with local files. Are you sure?',

	'settings.forceDownload.name': 'Force Full Download (Overwrite Local)',
	'settings.forceDownload.desc': 'Remote truth. Voids local extra files, pulls all NAS notes locally.',
	'settings.forceDownload.btn': 'Force Download',
	'settings.forceDownload.confirm': 'WARNING: This will delete local extra files and completely overwrite the local vault with NAS files. Are you sure?',

	'settings.rebuild.name': 'Rebuild Sync Base',
	'settings.rebuild.desc': 'Used after manual USB copy. Drops current sync state and builds a new baseline via hash checks.',
	'settings.rebuild.btn': 'Rebuild State',
	'settings.rebuild.confirm': 'Are you sure you want to forcibly rebuild the sync state snapshot?',

	// engine.ts
	'notice.engine.syncing': 'Syncing...',
	'notice.engine.syncSuccess': 'Sync Successful',
	'notice.engine.syncUpToDate': 'Up to date, no sync needed',

	// ui/sync-log-modal.ts
	'ui.logModal.title': 'Synology Sync Logs',
	'ui.logModal.empty': 'No sync logs available yet.',


};
