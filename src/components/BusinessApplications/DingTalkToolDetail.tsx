import { useEffect, useState } from 'react';
import { Braces, ChevronRight, ExternalLink, PanelRightClose, Play, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/shared/button/Button';
import {
  DINGTALK_RUNTIME_STATUS_TOOL,
  collectDingTalkSubmitLinks,
  shouldSurfaceDingTalkArguments,
  type DingTalkEffectiveTool,
  type DingTalkRuntimeProfileProjection,
  type DingTalkToolSchemaProjection,
} from '@/business-applications/dingtalkTools';
import { openDesktopExternalLink, resolveDesktopExternalLink } from '@/runtime/desktopExternalLink';
import { DingTalkProfileSelect } from './DingTalkProfileSelect';
import { DingTalkToolContractSummary } from './DingTalkToolContractSummary';
import { resolveDingTalkSubmitLinkFeedback, type DingTalkSubmitLinkOpenOutcome } from './dingTalkSubmitLinkPresentation';
import { PaneResizeHandle } from './PaneResizeHandle';

function prettyJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DingTalkToolDetail({
  tool,
  width,
  collapsed,
  profile,
  profiles,
  argumentsJson,
  schema,
  schemaLoading,
  schemaError,
  invocationOutput,
  invocationError,
  invoking,
  disabledReason,
  argumentsInvalid,
  missingRequiredParameters,
  onWidthChange,
  onCollapsedChange,
  onProfileChange,
  onArgumentsChange,
  onLoadSchema,
  onInvoke,
}: {
  tool: DingTalkEffectiveTool | null;
  width: number;
  collapsed: boolean;
  profile: string;
  profiles: readonly DingTalkRuntimeProfileProjection[];
  argumentsJson: string;
  schema: DingTalkToolSchemaProjection | null;
  schemaLoading: boolean;
  schemaError: string | null;
  invocationOutput: unknown;
  invocationError: string | null;
  invoking: boolean;
  disabledReason: string | null;
  argumentsInvalid: boolean;
  missingRequiredParameters: readonly string[];
  onWidthChange: (value: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onProfileChange: (value: string) => void;
  onArgumentsChange: (value: string) => void;
  onLoadSchema: () => void;
  onInvoke: () => void;
}) {
  const { t } = useTranslation();
  const runtimeTool = tool?.entry.id === DINGTALK_RUNTIME_STATUS_TOOL;
  const argumentsNeedAttention = shouldSurfaceDingTalkArguments({
    runtimeTool,
    argumentsInvalid,
    missingRequiredParameters,
  });
  const [advancedOpen, setAdvancedOpen] = useState(argumentsNeedAttention);
  const [openingSubmitUrl, setOpeningSubmitUrl] = useState<string | null>(null);
  const [submitLinkOutcome, setSubmitLinkOutcome] = useState<DingTalkSubmitLinkOpenOutcome | null>(null);
  const submitLinkFeedback = resolveDingTalkSubmitLinkFeedback(submitLinkOutcome);
  useEffect(() => {
    if (argumentsNeedAttention) setAdvancedOpen(true);
  }, [argumentsNeedAttention]);
  useEffect(() => {
    setOpeningSubmitUrl(null);
    setSubmitLinkOutcome(null);
  }, [invocationOutput]);
  const submitLinks = collectDingTalkSubmitLinks(invocationOutput).filter((link) => (
    resolveDesktopExternalLink(link.submitUrl) !== null
  ));

  const openSubmitUrl = async (submitUrl: string) => {
    if (openingSubmitUrl) return;
    setSubmitLinkOutcome(null);
    setOpeningSubmitUrl(submitUrl);
    try {
      await openDesktopExternalLink(submitUrl);
      setSubmitLinkOutcome('system-handoff');
    } catch {
      setSubmitLinkOutcome('failed');
    } finally {
      setOpeningSubmitUrl(null);
    }
  };

  if (collapsed) {
    return (
      <aside className="flex h-full min-h-0 flex-col items-center border-l border-aegis-border bg-aegis-surface/55 py-2">
        <IconButton aria-label={t('businessApplications.workbench.detail.expand')} title={t('businessApplications.workbench.detail.expand')} onClick={() => onCollapsedChange(false)}>
          <ChevronRight size={15} className="rotate-180" />
        </IconButton>
        <span className="mt-3 text-[10px] tracking-[0.18em] text-aegis-text-dim" style={{ writingMode: 'vertical-rl' }}>{t('businessApplications.workbench.detail.title')}</span>
      </aside>
    );
  }

  return (
    <aside className="relative flex h-full min-h-0 min-w-0 flex-col border-l border-aegis-border bg-aegis-surface/70">
      <PaneResizeHandle value={width} min={300} max={520} label={t('businessApplications.workbench.detail.resize')} onChange={onWidthChange} />
      <header className="flex min-h-11 shrink-0 items-center justify-between border-b border-aegis-border px-4 py-2">
        <span className="text-[12px] font-semibold text-aegis-text-secondary">{t('businessApplications.workbench.detail.title')}</span>
        <IconButton aria-label={t('businessApplications.workbench.detail.collapse')} title={t('businessApplications.workbench.detail.collapse')} onClick={() => onCollapsedChange(true)}>
          <PanelRightClose size={15} />
        </IconButton>
      </header>
      {!tool ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-[11px] text-aegis-text-dim">{t('businessApplications.workbench.detail.empty')}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold leading-5 text-aegis-text">{tool.entry.label}</h2>
              <p className="mt-1 text-[12px] leading-5 text-aegis-text-dim">{tool.entry.description}</p>
            </div>
            <span className="shrink-0 rounded-md border border-aegis-border bg-aegis-bg/45 px-2 py-1 text-[10px] text-aegis-text-dim">
              {t(`businessApplications.workbench.domain.${tool.domain}`)}
            </span>
          </div>
          <DingTalkToolContractSummary tool={tool} />

          {!runtimeTool && (
            <>
              <label className="mt-4 block text-[12px] font-medium text-aegis-text-secondary" htmlFor="dingtalk-profile">{t('businessApplications.workbench.detail.profileLabel')}</label>
              <DingTalkProfileSelect value={profile} profiles={profiles} disabled={invoking} onValueChange={onProfileChange} />
              <p className="mt-1.5 text-[10.5px] leading-4 text-aegis-text-dim">{t('businessApplications.workbench.detail.profileBoundary')}</p>

              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-aegis-text-secondary">{t('businessApplications.workbench.detail.parameters')}</span>
                <Button size="xs" variant="ghost" loading={schemaLoading} leadingIcon={<RefreshCw size={11} />} onClick={onLoadSchema}>{t('businessApplications.workbench.detail.reloadSchema')}</Button>
              </div>
              {schemaError && <p className="mt-1.5 text-[11px] leading-4 text-aegis-danger">{schemaError}</p>}
              {schema && (
                <div className="mt-1.5 overflow-hidden rounded-md border border-aegis-border">
                  {schema.parameters.length === 0 ? (
                    <div className="px-2.5 py-2 text-[11px] text-aegis-text-dim">{t('businessApplications.workbench.detail.noParameters')}</div>
                  ) : schema.parameters.map((parameter) => (
                    <div key={parameter.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-b border-aegis-border/60 px-2.5 py-2 text-[11px] last:border-b-0">
                      <code className="truncate text-aegis-text-secondary">{parameter.property ?? parameter.name}</code>
                      <span className="text-aegis-text-dim">{parameter.type}</span>
                      <span className={parameter.required ? 'text-aegis-warning' : 'text-aegis-text-dim'}>{parameter.required ? t('businessApplications.workbench.detail.required') : t('businessApplications.workbench.detail.optional')}</span>
                    </div>
                  ))}
                </div>
              )}

              <details className="mt-4 rounded-md border border-aegis-border bg-aegis-surface/35" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
                <summary className="cursor-pointer px-3 py-2.5 text-[11px] font-medium text-aegis-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aegis-primary/40">{t('businessApplications.workbench.detail.advanced')}</summary>
                <div className="border-t border-aegis-border px-3 py-3">
                  <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-y-2 text-[10.5px]">
                    <dt className="text-aegis-text-dim">{t('businessApplications.workbench.detail.toolId')}</dt>
                    <dd className="truncate font-mono text-aegis-text-secondary" title={tool.entry.id}>{tool.entry.id}</dd>
                    <dt className="text-aegis-text-dim">{t('businessApplications.workbench.detail.dwsPath')}</dt>
                    <dd className="truncate font-mono text-aegis-text-secondary" title={schema?.canonicalPath}>{schema?.canonicalPath ?? t('businessApplications.workbench.detail.notRead')}</dd>
                    <dt className="text-aegis-text-dim">{t('businessApplications.workbench.detail.schemaDigest')}</dt>
                    <dd className="truncate font-mono text-aegis-text-secondary" title={schema?.schemaDigest}>{schema?.schemaDigest ?? t('businessApplications.workbench.detail.notRead')}</dd>
                  </dl>
                  <label className="mt-3 block text-[11px] font-medium text-aegis-text-secondary" htmlFor="dingtalk-arguments">{t('businessApplications.workbench.detail.arguments')}</label>
                  {argumentsNeedAttention && (
                    <p id="dingtalk-arguments-hint" className="mt-1 text-[10.5px] leading-4 text-aegis-warning">
                      {argumentsInvalid
                        ? t('businessApplications.workbench.detail.argumentsInvalid')
                        : t('businessApplications.workbench.detail.missingRequiredParameters', { parameters: missingRequiredParameters.join(', ') })}
                    </p>
                  )}
                  <textarea
                    id="dingtalk-arguments"
                    value={argumentsJson}
                    onChange={(event) => onArgumentsChange(event.target.value)}
                    spellCheck={false}
                    aria-describedby={argumentsNeedAttention ? 'dingtalk-arguments-hint' : undefined}
                    className="mt-1.5 min-h-[120px] w-full resize-y rounded-md border border-aegis-border bg-aegis-bg p-2.5 font-mono text-[11px] leading-5 text-aegis-text outline-none focus:border-aegis-primary/60 focus:ring-2 focus:ring-aegis-primary/20"
                  />
                </div>
              </details>
            </>
          )}

          {invocationError && <p className="mt-4 text-[11px] leading-5 text-aegis-danger">{invocationError}</p>}
          {invocationOutput !== undefined && (
            <div className="mt-3">
              <div className="text-[12px] font-medium text-aegis-text-secondary">{t('businessApplications.workbench.detail.result')}</div>
              {submitLinks.length > 0 && (
                <section className="mt-2 rounded-md border border-aegis-primary/25 bg-aegis-primary/[0.05] p-2" aria-label={t('businessApplications.workbench.detail.submitLinksTitle')}>
                  <p className="text-[10px] font-medium text-aegis-text-secondary">{t('businessApplications.workbench.detail.submitLinksTitle')}</p>
                  <div className="mt-1.5 grid gap-1.5">
                    {submitLinks.map((link) => (
                      <Button
                        key={link.submitUrl}
                        fullWidth
                        size="xs"
                        variant="outline"
                        tone="primary"
                        loading={openingSubmitUrl === link.submitUrl}
                        disabled={openingSubmitUrl !== null && openingSubmitUrl !== link.submitUrl}
                        leadingIcon={<ExternalLink size={11} />}
                        aria-describedby="dingtalk-submit-link-status"
                        onClick={() => { void openSubmitUrl(link.submitUrl); }}
                      >
                        {t('businessApplications.workbench.detail.openSubmitLink', { formName: link.formName })}
                      </Button>
                    ))}
                  </div>
                  <p
                    id="dingtalk-submit-link-status"
                    role="status"
                    aria-live="polite"
                    className={submitLinkFeedback?.kind === 'notice' ? 'mt-1.5 text-[10px] leading-4 text-aegis-text-dim' : 'sr-only'}
                  >
                    {submitLinkFeedback?.kind === 'notice' ? t(submitLinkFeedback.translationKey) : ''}
                  </p>
                  {submitLinkFeedback?.kind === 'error' && <p role="alert" className="mt-1.5 text-[10px] leading-4 text-aegis-danger">{t(submitLinkFeedback.translationKey)}</p>}
                </section>
              )}
              <pre className="mt-1.5 max-h-[280px] overflow-auto rounded-md border border-aegis-border bg-aegis-bg p-2.5 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-5 text-aegis-text-dim">{prettyJson(invocationOutput)}</pre>
            </div>
          )}
        </div>
      )}
      {tool && (
        <footer className="shrink-0 border-t border-aegis-border bg-aegis-surface px-4 py-3">
          {tool.effect === 'write' && (
            <div className="mb-2.5 flex items-start gap-2 text-[10.5px] leading-4 text-aegis-warning">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t('businessApplications.workbench.detail.writeBoundary')}</span>
            </div>
          )}
          {disabledReason && <p className="mb-2 text-[10.5px] leading-4 text-aegis-warning">{disabledReason}</p>}
          <Button
            fullWidth
            size="md"
            variant="solid"
            tone={tool.effect === 'write' ? 'warning' : 'primary'}
            loading={invoking}
            disabled={Boolean(disabledReason)}
            leadingIcon={runtimeTool ? <Braces size={14} /> : <Play size={14} />}
            onClick={onInvoke}
          >
            {runtimeTool
              ? t('businessApplications.workbench.detail.checkRuntime')
              : tool.effect === 'write'
                ? t('businessApplications.workbench.detail.confirmAndExecute')
                : t('businessApplications.workbench.detail.executeRead')}
          </Button>
        </footer>
      )}
    </aside>
  );
}
