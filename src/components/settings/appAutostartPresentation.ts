import type { TFunction } from 'i18next';
import type { AppAutostartStatus } from '@/api/tauri-commands';

export interface AppAutostartPresentation {
  title: string;
  description: string;
  action: string;
  badge: string | null;
}

export function presentAppAutostart(
  status: AppAutostartStatus,
  t: TFunction,
): AppAutostartPresentation {
  return {
    title: t('setup.appAutostart.title'),
    description: t(status.enabled ? 'setup.appAutostart.enabledHint' : 'setup.appAutostart.disabledHint'),
    action: t(status.enabled ? 'setup.appAutostart.disable' : 'setup.appAutostart.enable'),
    badge: status.enabled ? t('setup.appAutostart.enabledBadge') : null,
  };
}
