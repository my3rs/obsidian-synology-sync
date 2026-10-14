import { t } from '../locales';

interface ListResponse {
    success: true;
    data: { items: Record<string, unknown>[]; total?: number; has_more?: boolean };
}

/** Drive v2 documents total, not has_more. Reject inconsistent pages before syncing. */
export async function readAllPages(
    fetchPage: (offset: number, limit: number) => Promise<unknown>,
    keyOf: (item: Record<string, unknown>) => unknown
): Promise<ListResponse> {
    const items: Record<string, unknown>[] = [];
    const seen = new Set<unknown>();
    let expectedTotal: number | undefined;
    let usesTotal: boolean | undefined;
    for (;;) {
        const page = await fetchPage(items.length, 200) as ListResponse | null;
        const data = page?.data;
        if (page?.success !== true || !data || !Array.isArray(data.items)) throw new Error(t('safety.invalidResponse'));
        const hasTotal = data.total !== undefined;
        if (usesTotal !== undefined && usesTotal !== hasTotal) throw new Error(t('safety.invalidResponse'));
        usesTotal = hasTotal;
        if (hasTotal) {
            if (!Number.isSafeInteger(data.total) || data.total! < 0
                || (expectedTotal !== undefined && data.total !== expectedTotal)) throw new Error(t('safety.invalidResponse'));
            expectedTotal = data.total;
        } else if (typeof data.has_more !== 'boolean') {
            throw new Error(t('safety.invalidResponse'));
        }
        for (const item of data.items) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(t('safety.invalidResponse'));
            const key = keyOf(item);
            if (typeof key !== 'string' || !key || seen.has(key)) throw new Error(t('safety.invalidResponse'));
            seen.add(key);
            items.push(item);
        }
        if (expectedTotal !== undefined && items.length > expectedTotal) throw new Error(t('safety.invalidResponse'));
        const more = expectedTotal !== undefined ? items.length < expectedTotal : data.has_more === true;
        if (!more) return { ...page, data: { ...data, items } };
        if (data.items.length === 0) throw new Error(t('safety.invalidResponse'));
    }
}
