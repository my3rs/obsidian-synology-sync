import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';

export class SynologyClient {
	private baseUrl: string;
	private username: string;
	private password?: string;
	private otpCode?: string; // 2FA 双重验证码
	private sid?: string; // Session ID

	constructor(baseUrl: string, username: string, password?: string, otpCode?: string) {
		// 确保不以斜杠结尾
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		this.username = username;
		this.password = password;
		this.otpCode = otpCode;
	}

	/**
	 * 通用的请求封装
	 */
	private async request(
		endpoint: string,
		params: any,
		method: 'GET' | 'POST' = 'GET',
		contentType: string = 'application/json'
	): Promise<RequestUrlResponse> {
		const url = new URL(this.baseUrl + endpoint);
		
		let req: RequestUrlParam = {
			url: url.toString(),
			method,
			headers: {
				'Accept': 'application/json',
			},
			throw: false // 不要让 Obsidian 在 4xx 报错时阻断我们读取 body
		};

		// 既加 Cookie，也加 URL 参数，双保险，防止部分客户端屏蔽 Cookie Header
		if (this.sid) {
			req.headers!['Cookie'] = `id=${this.sid};`;
			url.searchParams.append('_sid', this.sid);
		}

		if (method === 'GET') {
			Object.entries(params).forEach(([key, value]) => {
				url.searchParams.append(key, value as string);
			});
			req.url = url.toString();
		} else {
			req.url = url.toString(); // 保存可能追加了 _sid 的 URL
			req.headers!['Content-Type'] = contentType;
			if (contentType === 'application/json') {
				req.body = JSON.stringify(params);
			} else if (contentType === 'application/x-www-form-urlencoded') {
				const formParams = new URLSearchParams();
				Object.entries(params).forEach(([key, value]) => {
					formParams.append(key, value as string);
				});
				req.body = formParams.toString();
			}
		}

		const res = await requestUrl(req);
		if (res.status >= 400) {
			let errorDetail = '';
			try {
				if (res.json && res.json.error) {
					errorDetail = `API Error Code: ${res.json.error.code}`;
				} else {
					errorDetail = res.text;
				}
			} catch(e) {}
			throw new Error(`HTTP ${res.status}: ${errorDetail}`);
		}
		
		if (res.json && res.json.success === false) {
			const code = res.json.error?.code || 'Unknown';
			throw new Error(`API Error Code: ${code}`);
		}
		
		return res;
	}

	/**
	 * 获取鉴权 (Sign in)
	 */
	async login(): Promise<string> {
		if (!this.baseUrl || !this.username || !this.password) {
			throw new Error("请先填写完整 NAS 地址、用户名和密码");
		}

		const endpoint = '/api/SynologyDrive/default/v2/login';
		const payload: any = {
			format: 'sid',
			account: this.username,
			passwd: this.password
		};

		if (this.otpCode) {
			payload.otp_code = this.otpCode;
		}

		console.log(`[SynologyClient] 正在登录: ${this.baseUrl}`);
		
		try {
			const res = await this.request(endpoint, payload, 'POST', 'application/json');
			const result = res.json;

			if (result && result.success) {
				this.sid = result.data.sid;
				return this.sid as string;
			} else {
				throw new Error(result?.error?.code ? `Error Code: ${result.error.code}` : "登录失败，请检查账号密码");
			}
		} catch (error: any) {
			console.error("[SynologyClient] 登录异常", error);
			throw new Error(error.message || "请求异常，请检查 NAS 地址是否可达");
		}
	}

	/**
	 * 测试连接 (使用 login 接口验证)
	 */
	async testConnection(): Promise<boolean> {
		const sid = await this.login();
		return !!sid;
	}

	/**
	 * 获取文件或目录的元数据
	 */
	async getMetadata(path: string): Promise<any> {
		const endpoint = '/api/SynologyDrive/default/v2/files';
		const params = { path };
		try {
			const res = await this.request(endpoint, params, 'GET');
			return res.json;
		} catch (e: any) {
			if (e.message.includes('1003')) return null;
			throw e;
		}
	}

	/**
	 * 列出目录下的文件和文件夹
	 */
	async listFiles(path: string): Promise<any> {
		const endpoint = '/api/SynologyDrive/default/v2/files/list';
		const url = new URL(this.baseUrl + endpoint);
		url.searchParams.append('path', path);
		if (this.sid) url.searchParams.append('_sid', this.sid);

		let req: RequestUrlParam = {
			url: url.toString(),
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json'
			},
			throw: false
		};
		if (this.sid) req.headers!['Cookie'] = `id=${this.sid};`;
		req.body = "{}"; // 没有额外的 body

		const res = await requestUrl(req);
		if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.json || res.text)}`);
		return res.json;
	}

	/**
	 * 创建文件夹
	 */
	async createFolder(path: string): Promise<any> {
		const endpoint = '/api/SynologyDrive/default/v2/files';
		const url = new URL(this.baseUrl + endpoint);
		url.searchParams.append('type', 'folder');
		url.searchParams.append('path', path);
		url.searchParams.append('conflict_action', 'overwrite'); // 避免同名目录报错
		if (this.sid) url.searchParams.append('_sid', this.sid);

		let req: RequestUrlParam = {
			url: url.toString(),
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json'
			},
			throw: false
		};
		if (this.sid) req.headers!['Cookie'] = `id=${this.sid};`;
		req.body = "{}"; // 创建文件夹不需要 body

		const res = await requestUrl(req);
		if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.json || res.text)}`);
		
		if (res.json && res.json.success === false) {
			const code = res.json.error?.code || 'Unknown';
			throw new Error(`API Error Code: ${code}`);
		}
		
		return res.json;
	}

	/**
	 * 递归确保远程目录存在
	 */
	async ensureRemoteFolder(path: string): Promise<void> {
		const parts = path.split('/').filter(p => p);
		let current = '';
		for (let i = 0; i < parts.length; i++) {
			current += '/' + parts[i];
			if (current === '/mydrive' || current === '/team-folders' || (parts[0] === 'team-folders' && i === 1)) {
				continue;
			}
			try {
				await this.createFolder(current);
			} catch (e: any) {
				// Ignore errors, if it truly fails, the subsequent upload will fail anyway
			}
		}
	}

	/**
	 * 创建或覆盖文件 (通过 multipart/form-data 上传，支持大文件)
	 */
	async uploadFile(path: string, buffer: ArrayBuffer, isRetry: boolean = false): Promise<any> {
		const endpoint = '/api/SynologyDrive/default/v2/files/upload';
		const url = new URL(this.baseUrl + endpoint);
		
		if (this.sid) url.searchParams.append('_sid', this.sid);

		const boundary = '----WebKitFormBoundarySynoSync' + Math.random().toString(36).substring(2);
		const encoder = new TextEncoder();
		const parts: Uint8Array[] = [];

		const appendField = (name: string, value: string) => {
			parts.push(encoder.encode(`--${boundary}\r\n`));
			parts.push(encoder.encode(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
			parts.push(encoder.encode(`${value}\r\n`));
		};

		appendField('type', 'file');
		appendField('path', path);
		appendField('conflict_action', 'overwrite');

		parts.push(encoder.encode(`--${boundary}\r\n`));
		const filename = path.split('/').pop() || 'upload.bin';
		parts.push(encoder.encode(`Content-Disposition: form-data; name="file"; filename="${encodeURIComponent(filename)}"\r\n`));
		parts.push(encoder.encode(`Content-Type: application/octet-stream\r\n\r\n`));
		parts.push(new Uint8Array(buffer));
		parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

		const totalLength = parts.reduce((acc, part) => acc + part.length, 0);
		const body = new Uint8Array(totalLength);
		let offset = 0;
		for (const part of parts) {
			body.set(part, offset);
			offset += part.length;
		}

		let req: RequestUrlParam = {
			url: url.toString(),
			method: 'PUT',
			headers: {
				'Accept': 'application/json',
				'Content-Type': `multipart/form-data; boundary=${boundary}`
			},
			throw: false,
			body: body.buffer
		};
		if (this.sid) req.headers!['Cookie'] = `id=${this.sid};`;

		const res = await requestUrl(req);
		if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.json || res.text)}`);
		
		if (res.json && res.json.success === false) {
			const code = res.json.error?.code;
			if (code === 1000 && !isRetry) {
				const parentPath = path.substring(0, path.lastIndexOf('/'));
				if (parentPath && parentPath !== '/mydrive' && parentPath !== '') {
					await this.ensureRemoteFolder(parentPath);
					return this.uploadFile(path, buffer, true);
				}
			}
			throw new Error(`API Error Code: ${code || 'Unknown'} (File: ${path})`);
		}
		
		return res.json;
	}

	/**
	 * 下载文件
	 * 单个文件下载返回的应该是文件的 buffer (Content-Type 为对应的 mime)
	 */
	async downloadFile(path: string): Promise<ArrayBuffer> {
		const endpoint = '/api/SynologyDrive/default/v2/files/download';
		const res = await this.request(endpoint, { files: [path] }, 'POST', 'application/json');
		return res.arrayBuffer;
	}

	/**
	 * 删除文件或目录
	 */
	async deleteFile(path: string): Promise<any> {
		const endpoint = '/api/SynologyDrive/default/v2/files/delete';
		const res = await this.request(endpoint, { files: [path], permanent: false }, 'POST', 'application/json');
		return res.json;
	}

	/**
	 * 搜索自 start_date (Unix 时间戳，秒) 以来被修改过的文件或文件夹
	 */
	async search(location: string, fileType: 'file' | 'folder', startDateUnix?: number): Promise<any> {
		const endpoint = '/api/SynologyDrive/default/v2/files/search';
		const url = new URL(this.baseUrl + endpoint);
		if (this.sid) url.searchParams.append('_sid', this.sid);

		let req: RequestUrlParam = {
			url: url.toString(),
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json'
			},
			throw: false
		};
		if (this.sid) req.headers!['Cookie'] = `id=${this.sid};`;
		
		const body: any = {
			location: location,
			file_type: fileType,
			limit: 5000 // 调高单页上限，若不够后续可结合 offset 分页
		};
		if (startDateUnix) {
			body.start_date = startDateUnix;
			body.time = 'modified_time';
		}
		
		req.body = JSON.stringify(body);

		const res = await requestUrl(req);
		if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.json || res.text)}`);
		return res.json;
	}
	/**
	 * 获取文件历史版本列表
	 */
	async getFileRevisions(fileId: string): Promise<any[]> {
		const endpoint = '/webapi/entry.cgi';
		const params = {
			api: 'SYNO.SynologyDrive.Revisions',
			version: 1,
			method: 'list',
			file_id: fileId
		};
		const res = await this.request(endpoint, params, 'POST', 'application/x-www-form-urlencoded');
		if (res.json && res.json.success && res.json.data && res.json.data.revisions) {
			return res.json.data.revisions;
		}
		return [];
	}

	/**
	 * 下载指定历史版本
	 */
	async downloadRevision(fileId: string, revisionId: string): Promise<ArrayBuffer> {
		const endpoint = '/webapi/entry.cgi';
		const url = new URL(this.baseUrl + endpoint);
		url.searchParams.append('api', 'SYNO.SynologyDrive.Revisions');
		url.searchParams.append('version', '1');
		url.searchParams.append('method', 'download');
		url.searchParams.append('file_id', fileId.toString());
		url.searchParams.append('revision_id', revisionId.toString());
		if (this.sid) url.searchParams.append('_sid', this.sid);

		let req: any = {
			url: url.toString(),
			method: 'GET',
			headers: { 'Accept': '*/*' },
			throw: false
		};
		if (this.sid) req.headers['Cookie'] = `id=${this.sid};`;

		const res = await (window as any).reqUrl ? await (window as any).reqUrl(req) : await import('obsidian').then(m => m.requestUrl(req));
		if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${res.text}`);
		return res.arrayBuffer;
	}

	/**
	 * 在远程将文件恢复到指定历史版本
	 */
	async restoreRevision(fileId: string, revisionId: string): Promise<any> {
		const endpoint = '/webapi/entry.cgi';
		const params = {
			api: 'SYNO.SynologyDrive.Revisions',
			version: 1,
			method: 'restore',
			file_id: fileId,
			revision_id: revisionId
		};
		
		const res = await this.request(endpoint, params, 'POST', 'application/x-www-form-urlencoded');
		return res.json;
	}

}
