import { Image, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import type { ModelEntry } from './types';
import { buildDefaultModelOptions } from './providerDefaultSelection';

export function modelDisplayLabel(id: string, entry?: ModelEntry): string {
  return entry?.alias && entry.alias !== id ? `${entry.alias} · ${id}` : id;
}

export interface DefaultModelControlsProps {
  models: Record<string, ModelEntry>;
  primaryModel?: string;
  imageModel?: string;
  imageSupportMap?: Map<string, boolean>;
  onSetPrimary: (id: string | null) => void;
  onSetImageModel: (id: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function DefaultModelControls({
  models,
  primaryModel,
  imageModel,
  imageSupportMap,
  onSetPrimary,
  onSetImageModel,
  disabled = false,
  compact = false,
}: DefaultModelControlsProps) {
  const { t } = useTranslation();
  const entries = buildDefaultModelOptions(models, primaryModel);
  const imageEntries = buildDefaultModelOptions(models, imageModel).filter(([id, entry]) => (
    id === imageModel
    || imageSupportMap?.get(id)
    || resolveModelSupportsImage(entry) === true
  ));

  if (entries.length === 0 && imageEntries.length === 0) return null;

  return (
    <div className={clsx(
      'grid gap-3',
      compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2',
    )}>
      <div className="rounded-lg border border-aegis-border bg-aegis-surface p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase text-aegis-text-muted">
          <Star size={11} className="text-aegis-primary" />
          {t('config.defaultTextModel', 'Default Text Model')}
        </div>
        <select
          value={primaryModel ?? ''}
          disabled={disabled || entries.length === 0}
          onChange={(event) => onSetPrimary(event.target.value || null)}
          aria-label={t('config.defaultTextModel', 'Default Text Model')}
          className="w-full rounded-lg border border-aegis-border bg-aegis-elevated px-2 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary disabled:opacity-50"
        >
          <option value="">{t('config.notSet', 'Not set')}</option>
          {entries.map(([id, entry]) => (
            <option key={id} value={id}>{modelDisplayLabel(id, entry)}</option>
          ))}
        </select>
      </div>
      <div className="rounded-lg border border-aegis-border bg-aegis-surface p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase text-aegis-text-muted">
          <Image size={11} className="text-blue-400" />
          {t('config.defaultImageModel', 'Default Image Model')}
        </div>
        <select
          value={imageModel ?? ''}
          disabled={disabled || imageEntries.length === 0}
          onChange={(event) => onSetImageModel(event.target.value || null)}
          aria-label={t('config.defaultImageModel', 'Default Image Model')}
          className="w-full rounded-lg border border-aegis-border bg-aegis-elevated px-2 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary disabled:opacity-50"
        >
          <option value="">{t('config.notSet', 'Not set')}</option>
          {imageEntries.map(([id, entry]) => (
            <option key={id} value={id}>{modelDisplayLabel(id, entry)}</option>
          ))}
        </select>
        {imageEntries.length === 0 && (
          <p className="mt-1.5 text-[10px] text-aegis-text-muted">
            {t('config.imageModelStrictHint', 'No image-capable models detected in current selection')}
          </p>
        )}
      </div>
    </div>
  );
}
