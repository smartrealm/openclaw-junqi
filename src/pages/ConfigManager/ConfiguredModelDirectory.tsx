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

export function buildConfiguredModelRows(models: Record<string, ModelEntry>): ConfiguredModelRow[] {
  return Object.entries(models)
    .map(([reference, entry]) => ({ reference, entry, ...splitModelReference(reference) }))
    .sort((left, right) => (
      left.providerId.localeCompare(right.providerId) || left.modelId.localeCompare(right.modelId)
    ));
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
  const rows = useMemo(() => buildConfiguredModelRows(models), [models]);

  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-xs text-aegis-text-muted">{t('config.noModelsConfigured')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] table-fixed text-left">
        <thead className="border-b border-aegis-border bg-aegis-elevated/50 text-[10px] font-semibold text-aegis-text-muted">
          <tr>
            <th className="w-[20%] px-4 py-2.5">{t('config.provider')}</th>
            <th className="w-[33%] px-4 py-2.5">{t('config.modelId')}</th>
            <th className="w-[23%] px-4 py-2.5">{t('config.alias')}</th>
            <th className="w-[24%] px-4 py-2.5 text-right">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-aegis-border">
          {rows.map((row) => {
            const supportsImage = imageSupportMap.get(row.reference) === true;
            const isPrimary = matchesModelReference(row.reference, row.entry.alias, primaryModel);
            const isImagePrimary = matchesModelReference(row.reference, row.entry.alias, imageModel);
            return (
              <tr key={row.reference} className="transition-colors hover:bg-aegis-overlay/[0.035]">
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-aegis-text">
                    <ProviderIcon providerId={row.providerId} size={16} className="text-aegis-text-secondary" />
                    <span className="truncate" title={row.providerId}>{providerDisplayLabel(row.providerId)}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="truncate font-mono text-xs text-aegis-text" title={row.reference}>{row.modelId}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('block truncate text-sm', row.entry.alias ? 'text-aegis-text' : 'text-aegis-text-muted')} title={row.entry.alias}>
                    {row.entry.alias || t('config.notSet')}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSetPrimary(row.reference)}
                      title={isPrimary ? t('config.primaryModel') : t('config.setPrimary')}
                      className="grid size-8 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-overlay/10 hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Star size={14} className={isPrimary ? 'fill-aegis-primary text-aegis-primary' : undefined} />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || !supportsImage}
                      onClick={() => onSetImageModel(row.reference)}
                      title={supportsImage && !isImagePrimary ? t('config.setImageModel') : t('config.imageModel')}
                      className="grid size-8 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-overlay/10 hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Image size={14} className={isImagePrimary ? 'fill-aegis-primary text-aegis-primary' : undefined} />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRemove(row.reference)}
                      title={t('common.remove')}
                      className="grid size-8 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
