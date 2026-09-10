import { useTranslation } from 'react-i18next';
import type { DingTalkEffectiveTool } from '@/business-applications/dingtalkTools';

export function DingTalkToolContractSummary({ tool }: { tool: DingTalkEffectiveTool }) {
  const { t } = useTranslation();
  const effect = tool.effect === 'read'
    ? t('businessApplications.workbench.effect.read')
    : tool.effect === 'write'
      ? t('businessApplications.workbench.effect.write')
      : t('businessApplications.workbench.unverified');
  const risk = tool.entry.risk
    ? t(`businessApplications.workbench.risk.${tool.entry.risk}`)
    : t('businessApplications.workbench.unverified');

  return (
    <dl className="mt-4 grid grid-cols-[84px_minmax(0,1fr)] gap-y-2 border-y border-aegis-border py-3 text-[11px]">
      <dt className="text-aegis-text-dim">{t('businessApplications.workbench.effectLabel')}</dt>
      <dd className="text-aegis-text-secondary">{effect}</dd>
      <dt className="text-aegis-text-dim">{t('businessApplications.workbench.riskLabel')}</dt>
      <dd className="text-aegis-text-secondary">{risk}</dd>
      {tool.entry.deniedBySession && (
        <>
          <dt className="text-aegis-text-dim">{t('businessApplications.workbench.sessionLabel')}</dt>
          <dd className="text-aegis-danger">{t('businessApplications.workbench.sessionDenied')}</dd>
        </>
      )}
    </dl>
  );
}
