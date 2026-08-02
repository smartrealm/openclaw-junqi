import { AlertCircle, CircleDashed, KeyRound, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { CapabilityAvailability, CapabilityEffect, IntegrationState } from '@/business-applications/types';

const INTEGRATION_STATUS: Record<IntegrationState, { key: string; fallback: string; Icon: LucideIcon; className: string }> = {
  requires_runtime: { key: 'businessApplications.states.requiresRuntime', fallback: '需要运行时', Icon: CircleDashed, className: 'text-aegis-text-dim bg-aegis-hover/50' },
  requires_configuration: { key: 'businessApplications.states.requiresConfiguration', fallback: '需要配置', Icon: AlertCircle, className: 'text-aegis-warning bg-aegis-warning/10' },
  ready_for_authorization: { key: 'businessApplications.states.requiresAuthorization', fallback: '等待授权', Icon: KeyRound, className: 'text-aegis-primary bg-aegis-primary/10' },
};

const AVAILABILITY_STATUS: Record<CapabilityAvailability, { key: string; fallback: string }> = {
  requires_runtime: { key: 'businessApplications.states.requiresRuntime', fallback: '需要运行时' },
  requires_configuration: { key: 'businessApplications.states.requiresConfiguration', fallback: '需要配置' },
  requires_authorization: { key: 'businessApplications.states.requiresAuthorization', fallback: '等待授权' },
};

const EFFECT_STATUS: Record<CapabilityEffect, { key: string; fallback: string; className: string }> = {
  read: { key: 'businessApplications.effects.read', fallback: '读取', className: 'text-aegis-text-muted' },
  write: { key: 'businessApplications.effects.write', fallback: '写入', className: 'text-aegis-primary' },
  high_impact: { key: 'businessApplications.effects.highImpact', fallback: '需确认', className: 'text-aegis-warning' },
};

export function IntegrationStatus({ state }: { state: IntegrationState }) {
  const { t } = useTranslation();
  const definition = INTEGRATION_STATUS[state];
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium', definition.className)}>
      <definition.Icon size={12} aria-hidden="true" />
      {t(definition.key, definition.fallback)}
    </span>
  );
}

export function CapabilityAvailability({ availability }: { availability: CapabilityAvailability }) {
  const { t } = useTranslation();
  const definition = AVAILABILITY_STATUS[availability];
  return <span className="text-[10.5px] text-aegis-text-dim">{t(definition.key, definition.fallback)}</span>;
}

export function CapabilityEffectBadge({ effect }: { effect: CapabilityEffect }) {
  const { t } = useTranslation();
  const definition = EFFECT_STATUS[effect];
  return <span className={clsx('text-[10.5px] font-medium', definition.className)}>{t(definition.key, definition.fallback)}</span>;
}
