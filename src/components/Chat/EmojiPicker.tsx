import { useState, useRef, useEffect, type ComponentType } from 'react';
import { Smile } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import clsx from 'clsx';

// ═══════════════════════════════════════════════════════════
// Emoji Picker — premium floating emoji selector
// ═══════════════════════════════════════════════════════════

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}

export function EmojiPicker({ onSelect, disabled, defaultOpen = false }: EmojiPickerProps) {
  const { t } = useTranslation();
  const { language, theme } = useSettingsStore();
  const [open, setOpen] = useState(defaultOpen);
  const [pickerModule, setPickerModule] = useState<ComponentType<any> | null>(null);
  const [emojiData, setEmojiData] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || (pickerModule && emojiData)) return;
    let alive = true;
    Promise.all([
      import('@emoji-mart/react'),
      import('@emoji-mart/data/sets/15/native.json'),
    ])
      .then(([picker, data]) => {
        if (!alive) return;
        setPickerModule(() => picker.default);
        setEmojiData(data.default ?? data);
      })
      .catch(() => {
        if (!alive) return;
        setPickerModule(null);
        setEmojiData(null);
      });
    return () => {
      alive = false;
    };
  }, [emojiData, open, pickerModule]);

  const Picker = pickerModule;

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={clsx(
          'grid size-[34px] place-items-center rounded-lg transition-colors',
          open
            ? 'bg-aegis-primary/20 text-aegis-primary'
            : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-30'
        )}
        title={t('input.emoji')}
        aria-label={t('input.emoji')}
      >
        <Smile size={17} />
      </button>

      {/* Picker Popup */}
      {open && (
        <div className={clsx(
          "absolute bottom-full mb-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200",
          getDirection(language) === 'rtl' ? 'right-0' : 'left-0'
        )}>
          <div className="rounded-2xl overflow-hidden shadow-2xl border border-aegis-menu-border bg-aegis-menu-bg">
            {Picker && emojiData ? (
              <Picker
                data={emojiData}
                onEmojiSelect={(emoji: any) => {
                  onSelect(emoji.native);
                  setOpen(false);
                }}
                theme={theme === 'aegis-light' ? 'light' : 'dark'}
                locale={language}
                previewPosition="none"
                skinTonePosition="search"
                maxFrequentRows={2}
                perLine={8}
                navPosition="bottom"
                set="native"
              />
            ) : (
              <div className="flex h-[320px] w-[352px] items-center justify-center text-aegis-text-dim">
                <Smile size={18} className="animate-pulse" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
