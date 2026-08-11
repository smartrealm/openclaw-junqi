import { useMemo, useState } from 'react';
import { Check, Download, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { ChannelRuntimeIcon } from '@/components/shared/ChannelRuntimeIcon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { OfficialChannelCatalogEntry } from '@/services/openclawChannelRuntime';

export interface ChannelCatalogItem {
  entry: OfficialChannelCatalogEntry;
  label: string;
  stateLabel: string;
  configured: boolean;
  systemImage?: string;
  requiresManagedInstall: boolean;
}

interface ChannelCatalogDialogProps {
  open: boolean;
  items: ChannelCatalogItem[];
  disabled: boolean;
  installingChannelId: string;
  onClose: () => void;
  onSelect: (entry: OfficialChannelCatalogEntry) => void;
  onInstall: (channelId: string) => void;
}

export function ChannelCatalogDialog({
  open,
  items,
  disabled,
  installingChannelId,
  onClose,
  onSelect,
  onInstall,
}: ChannelCatalogDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredItems = useMemo(() => (
    normalizedQuery
      ? items.filter((item) => (
        item.label.toLocaleLowerCase().includes(normalizedQuery)
        || item.entry.id.toLocaleLowerCase().includes(normalizedQuery)
        || item.entry.origin.toLocaleLowerCase().includes(normalizedQuery)
      ))
      : items
  ), [items, normalizedQuery]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[min(720px,92dvh)] w-[min(720px,calc(100vw-24px))] max-w-none gap-0 overflow-hidden border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text shadow-float sm:rounded-lg">
        <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
          <DialogTitle className="text-[15px] font-semibold text-aegis-text">
            {t('channelsCenter.catalogTitle', 'Channel catalog')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[10.5px] leading-4 text-aegis-text-muted">
            {t('channelsCenter.catalogDescription', 'Channels and installation state reported by the selected OpenClaw Runtime.')}
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-aegis-border px-5 py-3">
          <label className="flex h-8 items-center gap-2 rounded-md border border-aegis-border bg-aegis-surface px-2.5 focus-within:ring-2 focus-within:ring-aegis-primary/30">
            <Search size={13} className="shrink-0 text-aegis-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('channelsCenter.searchChannels', 'Search channels')}
              aria-label={t('channelsCenter.searchChannels', 'Search channels')}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-aegis-text outline-none placeholder:text-aegis-text-muted"
            />
          </label>
        </div>

        <div className="max-h-[calc(92dvh-160px)] overflow-y-auto px-2 py-2">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-12 text-center text-[11px] text-aegis-text-muted">
              {t('channelsCenter.noCatalogResults', 'No matching channels')}
            </div>
          ) : (
            <div className="divide-y divide-aegis-border">
              {filteredItems.map((item) => {
                const installing = installingChannelId === item.entry.id;
                return (
                  <div key={item.entry.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-aegis-border bg-aegis-surface text-aegis-text-muted">
                      <ChannelRuntimeIcon systemImage={item.systemImage} />
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelect(item.entry)}
                      disabled={disabled || item.requiresManagedInstall}
                      className="min-w-0 flex-1 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <span className="block truncate text-[12px] font-semibold text-aegis-text">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-aegis-text-muted">{item.stateLabel}</span>
                    </button>
                    {item.configured ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-aegis-success">
                        <Check size={12} />
                        {t('channelsCenter.alreadyConfigured', 'Configured')}
                      </span>
                    ) : item.requiresManagedInstall ? (
                      <button
                        type="button"
                        onClick={() => onInstall(item.entry.id)}
                        disabled={disabled || Boolean(installingChannelId)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[10.5px] font-semibold text-aegis-text-secondary hover:bg-aegis-hover disabled:opacity-50"
                      >
                        {installing ? <LoadingIndicator size={12} /> : <Download size={12} />}
                        {t('channelsCenter.install', 'Install')}
                      </button>
                    ) : (
                      <Plus size={14} className="text-aegis-primary" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
