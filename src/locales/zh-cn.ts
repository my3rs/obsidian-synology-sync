export default {
	'plugin.name': 'Synology Sync',

	// main.ts commands & notices
	'command.uploadActive': '将当前文件上传到群晖',
	'command.downloadActive': '从群晖下载并覆盖当前文件',
	'command.runQuick': '运行 Synology Sync 同步 (快速)',
	'command.runFull': '运行 Synology Sync 同步 (全量)',
	'command.showLog': '查看 Synology Sync 同步日志',

	'notice.noActiveFile': '当前没有活动文件',
	'notice.loginRequired': '请先在设置中登录 Synology Drive',
	'notice.uploading': '正在上传到: {{targetPath}}',
	'notice.uploadSuccess': '上传成功!',
	'notice.uploadFailed': '上传失败: {{error}}',
	'notice.noActiveFileToDefine': '当前没有活动文件，无法确定路径',
	'notice.downloading': '正在从群晖下载: {{targetPath}}',
	'notice.downloadSuccess': '下载并覆盖成功!',
	'notice.downloadFailed': '下载失败: {{error}}',
	
	'status.standby': 'NAS: 待命',
	'status.standbyWithTime': 'NAS: 待命 ({{time}})',
	'status.syncing': 'NAS: 同步中...',
	'status.synced': 'NAS: 已同步',
	'status.error': 'NAS: 错误',
	'status.forceUploading': 'NAS: 强制上传中...',
	'status.forceDownloading': 'NAS: 强制下载中...',
	'status.rebuilding': 'NAS: 构建基准中...',

	'notice.syncException': '同步异常: {{error}}',
	'notice.nasParamsMissing': '未配置 NAS 参数或未登录',
	'notice.forceUploadSuccess': '强制全量上传完成',
	'notice.forceUploadFailed': '强制上传失败: {{error}}',
	'notice.forceDownloadSuccess': '强制全量下载完成',
	'notice.forceDownloadFailed': '强制下载失败: {{error}}',
	'notice.rebuildSuccess': '同步基准构建完成',
	'notice.rebuildFailed': '构建基准失败: {{error}}',

	// settings.ts
	'settings.nasUrl.name': 'NAS 地址 (URL)',
	'settings.nasUrl.desc': '例如: https://nas.example.com:5001',
	'settings.username.name': '用户名',
	'settings.username.desc': '群晖账号用户名',
	'settings.password.name': '密码',
	'settings.password.desc': '群晖账号密码',
	'settings.otp.name': '两步验证码 (2FA OTP)',
	'settings.otp.desc': '验证成功后会自动清空。仅当 Session 过期或首次登录时需要。',
	'settings.syncFolder.name': '同步目标文件夹',
	'settings.syncFolder.desc': '群晖上的同步目标文件夹，必须存在 (例如: /home/Drive/ObsidianSync)',
	
	'settings.testConn.name': '测试连接并登录',
	'settings.testConn.desc.hasSid': '当前已有授权会话 (SID)',
	'settings.testConn.desc.noSid': '当前未授权，请点击登录获取会话',
	'settings.testConn.btn.relogin': '重新登录',
	'settings.testConn.btn.test': '测试连接',
	'notice.connSuccess': '连接并登录成功',
	'notice.connFailed': '连接失败: {{error}}',

	'settings.dangerZone': '危险操作 (Danger Zone) / 首次初始化',
	'settings.forceUpload.name': '强制全量上传 (覆盖群晖)',
	'settings.forceUpload.desc': '以本地为准。强制清空远端额外文件，并将本地所有笔记推送到群晖。',
	'settings.forceUpload.btn': '强制上传',
	'settings.forceUpload.confirm': '警告：这会使用本地文件完全覆盖并重置群晖上的同步目录，您确定要执行吗？',

	'settings.forceDownload.name': '强制全量下载 (覆盖本地)',
	'settings.forceDownload.desc': '以群晖为准。强制清空本地额外文件，并将群晖所有笔记拉取到本地。',
	'settings.forceDownload.btn': '强制下载',
	'settings.forceDownload.confirm': '警告：这会清空本地额外文件，并使用群晖文件完全覆盖本地库，您确定要执行吗？',

	'settings.rebuild.name': '构建同步基准 (重建状态)',
	'settings.rebuild.desc': '适合已通过U盘手动拷贝的场景。清空现有同步状态，重新比对Hash并生成新的同步基准。',
	'settings.rebuild.btn': '重建状态',
	'settings.rebuild.confirm': '确认要强制重建同步状态快照吗？',

	// engine.ts
	'notice.engine.syncing': '正在同步...',

	// ui/sync-log-modal.ts
	'ui.logModal.title': 'Synology Sync 同步日志',
	'ui.logModal.empty': '暂无同步记录。',
};
