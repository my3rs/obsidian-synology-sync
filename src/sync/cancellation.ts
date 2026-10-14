import { t } from '../locales';

/** Check between operations; an in-flight NAS request cannot be cancelled by requestUrl. */
export function assertActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error(t('safety.cancelled'));
}
