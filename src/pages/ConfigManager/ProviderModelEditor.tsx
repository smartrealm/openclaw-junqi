import { useEffect, useMemo, useState } from 'react';
import { Check, Image, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { ModelEntry } from './types';
import { resolveModelSupportsImage } from '@/utils/providerModelCapabilities';
import { canonicalizeProviderModelRef } from './providerModelMutations';

interface ProviderModelEditorProps {
  providerId: string;
  models: Record<string, ModelEntry>;
  primaryModel?: string;
  imageModel?: string;
  imageSupportMap?: Map<string, boolean>;
  disabled?: boolean;
  onAdd: (modelId: string, alias: string, supportsImage: boolean) => void;
  onUpdate: (modelRef: string, patch: { alias?: string; supportsImage?: boolean }) => void;
  onRemove: (modelRef: string) => void;
  onSetPrimary: (modelRef: string) => void;
  onSetImageModel: (modelRef: string) => void;
}

export function ProviderModelEditor({
  providerId,
  models,
  primaryModel,
  imageModel,
  imageSupportMap,
  disabled = false,
  onAdd,
  onUpdate,
  onRemove,
  onSetPrimary,
  onSetImageModel,
}: ProviderModelEditorProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [modelId, setModelId] = useState('');
  const [alias, setAlias] = useState('');
  const [imageCapable, setImageCapable] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setAliasDrafts(Object.fromEntries(
      Object.entries(models).map(([ref, entry]) => [ref, entry.alias ?? '']),
    ));
  }, [models]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return Object.entries(models).filter(([ref, entry]) => (
      !query || ref.toLowerCase().includes(query) || String(entry.alias ?? '').toLowerCase().includes(query)
    ));
  }, [models, search]);

  const resetAdd = () => {
    setAdding(false);
    setModelId('');
    setAlias('');
    setImageCapable(false);
    setError('');
  };

  const submitAdd = () => {
    const rawId = modelId.trim().replace(/^\/+|\/+$/g, '');
    if (!rawId) {
      setError(t('config.modelIdRequired', 'Model ID is required'));
      return;
    }
    const fullRef = canonicalizeProviderModelRef(providerId, rawId);
    const alreadyExists = fullRef && Object.keys(models).some(
      (ref) => canonicalizeProviderModelRef(providerId, ref) === fullRef,
    );
    if (alreadyExists) {
      setError(t('config.modelAlreadyExists', 'This model is already enabled'));
      return;
    }
    onAdd(rawId, alias.trim(), imageCapable);
    resetAdd();
  };

  return (
    <section className="overflow-hidden rounded-lg border border-aegis-border bg-aegis-surface">
      <header className="flex flex-col gap-2 border-b border-aegis-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-aegis-text-muted" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('config.searchModels', 'Search models')}
            aria-label={t('config.searchModels', 'Search models')}
            className="w-full rounded-md border border-aegis-border bg-aegis-elevated py-1.5 pl-8 pr-3 text-xs text-aegis-text outline-none transition-colors focus:border-aegis-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={disabled || adding}
          className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-aegis-primary/25 bg-aegis-primary/8 px-3 text-xs font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/14 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={13} />
          {t('config.addModel', 'Add model')}
        </button>
      </header>

      {adding && (
        <div className="grid gap-2 border-b border-aegis-border bg-aegis-elevated/60 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] md:items-end">
          <label className="min-w-0 text-[11px] font-medium text-aegis-text-secondary">
            {t('config.modelId', 'Model ID')}
            <input
              autoFocus
              value={modelId}
              disabled={disabled}
              onChange={(event) => { setModelId(event.target.value); setError(''); }}
              onKeyDown={(event) => event.key === 'Enter' && submitAdd()}
              placeholder="model-name"
              className="mt-1 w-full rounded-md border border-aegis-border bg-aegis-surface px-2.5 py-2 font-mono text-xs text-aegis-text outline-none focus:border-aegis-primary"
            />
          </label>
          <label className="min-w-0 text-[11px] font-medium text-aegis-text-secondary">
            {t('config.alias', 'Alias')}
            <input
              value={alias}
              disabled={disabled}
              onChange={(event) => setAlias(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitAdd()}
              placeholder={t('config.aliasOptional', 'Optional')}
              className="mt-1 w-full rounded-md border border-aegis-border bg-aegis-surface px-2.5 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary"
            />
          </label>
          <button
            type="button"
            aria-pressed={imageCapable}
            disabled={disabled}
            onClick={() => setImageCapable((value) => !value)}
            className={clsx(
              'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
              imageCapable
                ? 'border-blue-400/35 bg-blue-400/10 text-blue-300'
                : 'border-aegis-border text-aegis-text-muted hover:text-aegis-text',
            )}
          >
            <Image size={13} />
            {t('config.imageInput', 'Image input')}
          </button>
          <div className="flex items-center justify-end gap-1">
            <button type="button" title={t('common.cancel', 'Cancel')} onClick={resetAdd} className="grid size-9 place-items-center rounded-md text-aegis-text-muted hover:bg-aegis-overlay/10 hover:text-aegis-text">
              <X size={15} />
            </button>
            <button type="button" disabled={disabled} title={t('common.add', 'Add')} onClick={submitAdd} className="grid size-9 place-items-center rounded-md bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
              <Check size={15} />
            </button>
          </div>
          {error && <p className="text-xs text-red-400 md:col-span-4">{error}</p>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] table-fixed text-left">
          <thead className="bg-aegis-elevated/50 text-[10px] font-semibold text-aegis-text-muted">
            <tr>
              <th className="w-[38%] px-3 py-2">{t('config.modelId', 'Model ID')}</th>
              <th className="w-[28%] px-3 py-2">{t('config.alias', 'Alias')}</th>
              <th className="w-[14%] px-3 py-2 text-center">{t('config.imageInput', 'Image input')}</th>
              <th className="w-[20%] px-3 py-2 text-right">{t('common.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-aegis-border">
            {rows.map(([ref, entry]) => {
              const supportsImage = imageSupportMap?.get(ref) ?? resolveModelSupportsImage(entry) ?? false;
              const isPrimary = primaryModel === ref;
              const isImagePrimary = imageModel === ref;
              const removing = confirmRemove === ref;
              return (
                <tr key={ref} className="group transition-colors hover:bg-aegis-overlay/[0.035]">
                  <td className="px-3 py-2.5">
                    <div className="truncate font-mono text-xs text-aegis-text" title={ref}>{ref}</div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={aliasDrafts[ref] ?? ''}
                      disabled={disabled}
                      onChange={(event) => setAliasDrafts((current) => ({ ...current, [ref]: event.target.value }))}
                      onBlur={() => {
                        const nextAlias = (aliasDrafts[ref] ?? '').trim();
                        const currentAlias = String(entry.alias ?? '').trim();
                        if (!disabled && nextAlias !== currentAlias) {
                          onUpdate(ref, { alias: nextAlias });
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                      placeholder={t('config.noAlias', 'No alias')}
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs text-aegis-text-secondary outline-none transition-colors hover:border-aegis-border focus:border-aegis-primary focus:bg-aegis-elevated"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      aria-pressed={supportsImage}
                      disabled={disabled}
                      onClick={() => onUpdate(ref, { alias: aliasDrafts[ref] ?? '', supportsImage: !supportsImage })}
                      className={clsx(
                        'inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors',
                        supportsImage
                          ? 'border-blue-400/30 bg-blue-400/10 text-blue-300'
                          : 'border-aegis-border text-aegis-text-muted hover:text-aegis-text',
                      )}
                    >
                      <Image size={12} />
                      {supportsImage ? t('common.yes', 'Yes') : t('common.no', 'No')}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" disabled={disabled} onClick={() => onSetPrimary(ref)} title={t('config.setPrimary', 'Set as primary')} className="grid size-8 place-items-center rounded-md hover:bg-aegis-overlay/10">
                        <Star size={14} className={isPrimary ? 'fill-yellow-400 text-yellow-400' : 'text-aegis-text-muted'} />
                      </button>
                      <button type="button" disabled={disabled || !supportsImage} onClick={() => onSetImageModel(ref)} title={t('config.setImageModel', 'Set as image model')} className="grid size-8 place-items-center rounded-md hover:bg-aegis-overlay/10 disabled:cursor-not-allowed disabled:opacity-35">
                        <Image size={14} className={isImagePrimary ? 'fill-blue-400 text-blue-400' : 'text-aegis-text-muted'} />
                      </button>
                      {removing ? (
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setConfirmRemove(null)} className="px-2 py-1 text-[11px] text-aegis-text-muted hover:text-aegis-text">{t('common.cancel', 'Cancel')}</button>
                          <button type="button" disabled={disabled} onClick={() => { onRemove(ref); setConfirmRemove(null); }} className="rounded-md bg-red-500/12 px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50">{t('common.confirm', 'Confirm')}</button>
                        </div>
                      ) : (
                        <button type="button" disabled={disabled} onClick={() => setConfirmRemove(ref)} title={t('common.remove', 'Remove')} className="grid size-8 place-items-center rounded-md text-aegis-text-muted hover:bg-red-500/10 hover:text-red-400">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className="px-4 py-8 text-center text-xs text-aegis-text-muted">
          {search ? t('config.noModelsFound', 'No matching models') : t('config.noModelsConfigured', 'No models configured')}
        </div>
      )}
    </section>
  );
}
