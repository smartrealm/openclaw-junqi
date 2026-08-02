import { Image, Star, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ProviderIcon, providerDisplayLabel } from '@/components/shared/provider-identity';
import type { ModelEntry } from './types';

interface ConfiguredModelDirectoryProps {
  models: Record<string, ModelEntry>;
  primaryModel?: string;
  imageModel?: string;
  imageSupportMap: Map<string, boolean>;
  disabled?: boolean;
  onSetPrimary: (reference: string) => void;
  onSetImageModel: (reference: string) => void;
  onRemove: (reference: string) => void;
}

export interface ConfiguredModelRow {
  reference: string;
  providerId: string;
  modelId: string;
  entry: ModelEntry;
}

export interface ConfiguredModelGroup {
  providerId: string;
  models: ConfiguredModelRow[];
}

function splitModelReference(reference: string): Pick<ConfiguredModelRow, 'providerId' | 'modelId'> {
  const separator = reference.indexOf('/');
  if (separator <= 0 || separator === reference.length - 1) {
    return { providerId: reference, modelId: reference };
  }
  return {
    providerId: reference.slice(0, separator),
    modelId: reference.slice(separator + 1),
  };
}

export function buildConfiguredModelGroups(models: Record<string, ModelEntry>): ConfiguredModelGroup[] {
  const groups = new Map<string, ConfiguredModelRow[]>();

  for (const [reference, entry] of Object.entries(models)) {
    const row = { reference, entry, ...splitModelReference(reference) };
    const providerModels = groups.get(row.providerId) ?? [];
    providerModels.push(row);
    groups.set(row.providerId, providerModels);
  }

  return Array.from(groups, ([providerId, providerModels]) => ({
    providerId,
    models: providerModels.sort((left, right) => left.modelId.localeCompare(right.modelId)),
  })).sort((left, right) => left.providerId.localeCompare(right.providerId));
}

function matchesModelReference(reference: string, alias: string | undefined, selected: string | undefined): boolean {
  return selected === reference || (Boolean(alias) && selected === alias);
}

export function ConfiguredModelDirectory({
  models,
  primaryModel,
  imageModel,
  imageSupportMap,
  disabled = false,
  onSetPrimary,
  onSetImageModel,
  onRemove,
}: ConfiguredModelDirectoryProps) {
  const { t } = useTranslation();
  const groups = useMemo(() => buildConfiguredModelGroups(models), [models]);

  if (groups.length === 0) {
    return <p className="px-4 py-8 text-center text-xs text-aegis-text-muted">{t('config.noModelsConfigured')}</p>;
  }

  return (
    <div className="divide-y divide-aegis-border">
      {groups.map((group) => (
        <section key={group.providerId} aria-labelledby={`configured-provider-${group.providerId}`}>
          <div className="flex min-w-0 items-center gap-3 bg-aegis-surface/55 px-4 py-3 sm:px-5">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-aegis-border bg-aegis-elevated text-aegis-text-secondary">
              <ProviderIcon providerId={group.providerId} size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 id={`configured-provider-${group.providerId}`} className="truncate text-sm font-semibold text-aegis-text">
                {providerDisplayLabel(group.providerId)}
              </h4>
              <div className="truncate font-mono text-[10px] text-aegis-text-muted" title={group.providerId}>
                {group.providerId}
              </div>
            </div>
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-aegis-text-muted">
              {t('config.configuredModelCount', { count: group.models.length })}
            </span>
          </div>

          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(120px,0.55fr)_minmax(112px,auto)_108px] gap-4 border-y border-aegis-border/70 px-5 py-2 text-[10px] font-semibold text-aegis-text-muted sm:grid">
            <span>{t('config.modelName')}</span>
            <span>{t('config.modelAlias')}</span>
            <span>{t('config.modelRole')}</span>
            <span className="text-right">{t('config.modelActions')}</span>
          </div>

          <div className="divide-y divide-aegis-border/70">
            {group.models.map((row) => {
              const supportsImage = imageSupportMap.get(row.reference) === true;
              const isPrimary = matchesModelReference(row.reference, row.entry.alias, primaryModel);
              const isImagePrimary = matchesModelReference(row.reference, row.entry.alias, imageModel);
              return (
                <div
                  key={row.reference}
                  className="grid min-w-0 gap-2 px-4 py-3 transition-colors hover:bg-aegis-overlay/[0.035] sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.55fr)_minmax(112px,auto)_108px] sm:items-center sm:gap-4 sm:px-5"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium text-aegis-text" title={row.reference}>
                      {row.modelId}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-muted sm:hidden" title={row.reference}>
                      {row.reference}
                    </div>
                  </div>

                  <div className="min-w-0 text-xs sm:text-sm">
                    <span className="me-1.5 text-[10px] font-medium text-aegis-text-muted sm:hidden">
                      {t('config.modelAlias')}
                    </span>
                    <span
                      className={clsx('inline-block max-w-full truncate align-bottom', row.entry.alias ? 'text-aegis-text-secondary' : 'text-aegis-text-muted')}
                      title={row.entry.alias}
                    >
                      {row.entry.alias || t('config.notSet')}
                    </span>
                  </div>

                  <div className="flex min-h-6 flex-wrap items-center gap-1.5">
                    {isPrimary && (
                      <span className="inline-flex items-center gap-1 rounded border border-aegis-primary/25 bg-aegis-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-aegis-primary">
                        <Star size={10} className="fill-current" aria-hidden="true" />
                        {t('config.primaryModel')}
                      </span>
                    )}
                    {isImagePrimary && (
                      <span className="inline-flex items-center gap-1 rounded border border-aegis-border bg-aegis-surface px-1.5 py-0.5 text-[10px] font-medium text-aegis-text-secondary">
                        <Image size={10} aria-hidden="true" />
                        {t('config.imageModel')}
                      </span>
                    )}
                    {!isPrimary && !isImagePrimary && (
                      <span className="text-[10px] text-aegis-text-muted">{t('config.noModelRole')}</span>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSetPrimary(row.reference)}
                      aria-label={isPrimary ? t('config.primaryModel') : t('config.setPrimary')}
                      title={isPrimary ? t('config.primaryModel') : t('config.setPrimary')}
                      className="grid size-8 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-overlay/10 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Star size={14} className={isPrimary ? 'fill-aegis-primary text-aegis-primary' : undefined} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || !supportsImage}
                      onClick={() => onSetImageModel(row.reference)}
                      aria-label={supportsImage && !isImagePrimary ? t('config.setImageModel') : t('config.imageModel')}
                      title={supportsImage && !isImagePrimary ? t('config.setImageModel') : t('config.imageModel')}
                      className="grid size-8 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-overlay/10 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Image size={14} className={isImagePrimary ? 'fill-aegis-primary text-aegis-primary' : undefined} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRemove(row.reference)}
                      aria-label={t('config.removeModel', { model: row.modelId })}
                      title={t('config.remove')}
                      className="grid size-8 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
