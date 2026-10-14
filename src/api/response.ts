import { t } from '../locales';

export interface ApiResponse {
    success?: boolean;
    error?: { code?: number | string };
    data?: Record<string, unknown>;
}

export class SynologyApiError extends Error {
    constructor(readonly code: number | string | undefined, readonly status: number) {
        super(`${status >= 400 ? `HTTP ${status}: ` : ''}API Error Code: ${code ?? 'Unknown'}`);
        this.name = 'SynologyApiError';
    }
}

type Response = { status: number; text: string; json: unknown };

export function checkResponseError(response: Response): void {
    const json = response.json as ApiResponse | null;
    if (json?.success === false || (response.status >= 400 && json?.error)) {
        throw new SynologyApiError(json?.error?.code, response.status);
    }
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${response.text || `HTTP ${response.status}`}`);
}

/** A proxy/login page or truncated JSON must never acknowledge a remote mutation. */
export function requireApiSuccess(response: Response): ApiResponse {
    checkResponseError(response);
    const json = response.json as ApiResponse | null;
    if (json?.success !== true) throw new Error(t('safety.invalidResponse'));
    return json;
}
