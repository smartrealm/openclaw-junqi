import type { TFunction } from 'i18next';
import type { GatewayAutostartStatus } from '@/api/tauri-commands';

function serviceName(status: GatewayAutostartStatus, t: TFunction): string {
  return t(`setup.autostart.service.${status.serviceKind}`);
}

export interface GatewayAutostartPresentation {
  title: string;
  description: string;
  badge: string | null;
  action: string;
}

/** Shared, backend-driven copy for every Gateway autostart entry point. */
export function presentGatewayAutostart(
  status: GatewayAutostartStatus,
  t: TFunction,
): GatewayAutostartPresentation {
  const service = serviceName(status, t);
  const description = !status.enabled
    ? t('setup.autostart.disabledHint', { service })
    : status.running
      ? t('setup.autostart.enabledRunningHint', { service })
      : t('setup.autostart.enabledWaitingHint', { service });

  return {
    title: t('setup.autostart.title'),
    description,
    badge: status.enabled
      ? t(status.running ? 'setup.autostart.enabledRunningBadge' : 'setup.autostart.enabledWaitingBadge')
      : null,
    action: t(status.enabled ? 'setup.autostart.disable' : 'setup.autostart.enable'),
  };
}
