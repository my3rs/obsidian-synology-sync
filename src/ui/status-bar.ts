import { setIcon, setTooltip } from 'obsidian';
import type { SyncUIState } from '../sync/controller';
import { t } from '../locales';

export function renderSyncStatus(element: HTMLElement, state: SyncUIState, lastSyncTime?: number, count = 0): void {
    element.empty();
    const status = {
        idle: [lastSyncTime ? 'check-circle' : 'cloud', lastSyncTime
            ? t('status.standbyWithTime', { time: new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
            : t('status.standby')],
        pending: ['upload-cloud', count ? t('status.pending', { count: String(count) }) : t('status.checkPending')],
        'waiting-network': ['wifi-off', t('status.waitingNetwork', { count: String(count) })],
        'waiting-lock': ['clock', t('status.waitingLock', { count: String(count) })],
        syncing: ['refresh-cw', t('status.syncing')],
        'force-uploading': ['upload-cloud', t('status.forceUploading')],
        'force-downloading': ['download-cloud', t('status.forceDownloading')],
        rebuilding: ['database', t('status.rebuilding')],
        error: ['alert-triangle', t('status.error')]
    } satisfies Record<SyncUIState, [string, string]>;
    const [icon, text] = status[state];
    setIcon(element, icon);
    setTooltip(element, text, { placement: 'top' });
    element.setAttribute('aria-label', text);
}
