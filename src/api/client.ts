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
			}
		};

		// 如果已有 sid，将其放入 Header 或者 Query，目前 API 文档中后续调用的鉴权方式通常是在 header 里带 authorization 或是 cookie，
		// 但由于有些是直接放入 body 或者 query，这里为了通用，我们先保留一个扩展点。
		// 如果后续文档表明 sid 在 query 里，我们在 GET 里追加，如果是在 header，我们在 header 里追加。
		if (this.sid) {
			// 具体取决于后续 API 文档，暂定放到 Authorization Header
			req.headers!['Authorization'] = `Bearer ${this.sid}`;
		}

		if (method === 'GET') {
			Object.entries(params).forEach(([key, value]) => {
				url.searchParams.append(key, value as string);
			});
			req.url = url.toString();
		} else {
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

		return await requestUrl(req);
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
}
