import { AtSign, Camera, Mic, Paperclip, Plus, Radio, Send, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ComposerSuggestionMenus } from './ComposerSuggestionMenus';
import type { useComposerAttachments } from './useComposerAttachments';
import type { useComposerMenu } from './useComposerMenu';
import type { useComposerSuggestions } from './useComposerSuggestions';

interface ComposerInputSurfaceProps {
  activeSessionKey: string;
  dir: 'ltr' | 'rtl';
  connected: boolean;
  historyLoading: boolean;
  text: string;
  pendingCount: number;
  isTyping: boolean;
  isSending: boolean;
  voiceOutputActive: boolean;
  attachments: ReturnType<typeof useComposerAttachments>;
  suggestions: ReturnType<typeof useComposerSuggestions>;
  menu: ReturnType<typeof useComposerMenu>;
  dictationEnabled: boolean;
  onStartRecording: () => void;
  onToggleDictation: () => void;
  onSend: () => Promise<void>;
  onStop: () => Promise<void>;
}

export function ComposerInputSurface({
  activeSessionKey,
  dir,
  connected,
  historyLoading,
  text,
  pendingCount,
  isTyping,
  isSending,
  voiceOutputActive,
  attachments,
  suggestions,
  menu,
  dictationEnabled,
  onStartRecording,
  onToggleDictation,
  onSend,
  onStop,
}: ComposerInputSurfaceProps) {
  const { t } = useTranslation();
  const disabled = !connected || historyLoading;
  const canSend = Boolean(text.trim() || attachments.files.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-[784px] items-end gap-2 p-3" dir={dir}>
      <div
        className={clsx(
          'relative flex flex-1 flex-col gap-1 rounded-2xl border border-[rgb(var(--aegis-overlay)/0.06)] bg-aegis-surface px-3 py-2',
          'transition-[border-color,box-shadow] duration-200 focus-within:border-aegis-primary/30',
          'focus-within:shadow-[0_0_0_3px_rgb(var(--aegis-primary)/0.06),0_0_16px_rgb(var(--aegis-primary)/0.08)]',
          !connected && 'opacity-40',
        )}
        onDrop={attachments.drop}
        onDragOver={(event) => event.preventDefault()}
      >
        <div className="flex w-full items-center gap-2">
          <div ref={menu.addRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => menu.setActive((current) => current === 'add' ? null : 'add')}
              disabled={disabled}
              className={clsx(
                'grid size-[34px] place-items-center rounded-lg transition-colors',
                menu.active === 'add'
                  ? 'bg-aegis-primary/12 text-aegis-primary'
                  : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-30',
              )}
              title={t('input.addContent')}
              aria-label={t('input.addContent')}
              aria-haspopup="menu"
              aria-expanded={menu.active === 'add'}
            >
              <Plus size={17} />
            </button>
            {menu.active === 'add' && (
              <div
                role="menu"
                aria-label={t('input.addContent')}
                className={clsx(
                  'absolute bottom-full z-50 mb-2 w-40 overflow-hidden border border-aegis-menu-border bg-aegis-menu-bg p-1 shadow-[var(--aegis-menu-shadow)]',
                  dir === 'rtl' ? 'right-0' : 'left-0',
                )}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { menu.close(); void attachments.selectFiles(); }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                >
                  <Paperclip size={14} className="shrink-0 text-aegis-primary" />
                  {t('input.attachFile')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { menu.close(); attachments.setScreenshotSessionKey(activeSessionKey); }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                >
                  <Camera size={14} className="shrink-0 text-aegis-primary" />
                  {t('input.screenshot')}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={suggestions.openMentions}
            disabled={!connected || suggestions.skills.length === 0}
            className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-[rgb(var(--aegis-overlay)/0.03)] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] disabled:opacity-30"
            title={t('input.skills')}
            aria-label={t('input.skills')}
          >
            <AtSign size={16} />
          </button>

          <ComposerSuggestionMenus controller={suggestions} />
          <textarea
            ref={suggestions.textareaRef}
            data-input="message"
            rows={1}
            value={text}
            onChange={suggestions.onChange}
            onCompositionStart={() => { suggestions.composingRef.current = true; }}
            onCompositionEnd={() => { window.setTimeout(() => { suggestions.composingRef.current = false; }, 0); }}
            onKeyDown={(event) => suggestions.onKeyDown(event, () => { void onSend(); })}
            onPaste={attachments.paste}
            placeholder={historyLoading
              ? t('input.placeholderHistoryLoading')
              : connected ? t('input.placeholderSlash') : t('input.placeholderDisconnected')}
            className="max-h-[180px] flex-1 resize-none border-none bg-transparent px-1 py-1.5 text-[14px] leading-[1.2] text-aegis-text placeholder:text-aegis-text-muted focus:outline-none focus-visible:shadow-none scrollbar-hidden"
            dir={dir}
          />

          <div ref={menu.voiceRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                if (dictationEnabled) onToggleDictation();
                else menu.setActive((current) => current === 'voice' ? null : 'voice');
              }}
              disabled={disabled}
              className={clsx(
                'relative grid size-[34px] place-items-center rounded-lg transition-colors',
                dictationEnabled || menu.active === 'voice'
                  ? 'bg-aegis-primary/12 text-aegis-primary hover:bg-aegis-primary/18'
                  : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-30',
              )}
              title={dictationEnabled ? t('input.stopDictation') : t('input.voiceInput')}
              aria-label={dictationEnabled ? t('input.stopDictation') : t('input.voiceInput')}
              aria-haspopup={dictationEnabled ? undefined : 'menu'}
              aria-expanded={menu.active === 'voice'}
            >
              <Mic size={16} />
              {dictationEnabled && <span className="absolute end-1 top-1 size-1.5 rounded-full bg-aegis-primary ring-2 ring-aegis-surface" />}
            </button>
            {menu.active === 'voice' && (
              <div
                role="menu"
                aria-label={t('input.voiceInputMenu')}
                className={clsx(
                  'absolute bottom-full z-50 mb-2 w-40 overflow-hidden border border-aegis-menu-border bg-aegis-menu-bg p-1 shadow-[var(--aegis-menu-shadow)]',
                  dir === 'rtl' ? 'right-0' : 'left-0',
                )}
              >
                <button type="button" role="menuitem" onClick={onStartRecording} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60">
                  <Mic size={14} className="shrink-0 text-aegis-primary" />
                  {t('input.recordVoice')}
                </button>
                <button type="button" role="menuitem" onClick={onToggleDictation} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60">
                  <Radio size={14} className="shrink-0 text-aegis-primary" />
                  {t('input.continuousDictation')}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => { void onSend(); }}
            disabled={!canSend || disabled}
            className={clsx(
              'relative grid size-[34px] shrink-0 place-items-center rounded-lg transition-[background-color,color,box-shadow,transform]',
              canSend
                ? 'bg-aegis-primary text-white shadow-[0_2px_8px_rgb(var(--aegis-primary)/0.3)] hover:-translate-y-px hover:shadow-[0_4px_16px_rgb(var(--aegis-primary)/0.4)]'
                : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text',
              'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
            )}
            title={historyLoading ? t('input.historyLoading') : isTyping ? t('input.queue') : t('input.send')}
            aria-label={historyLoading ? t('input.historyLoading') : isTyping ? t('input.queue') : t('input.send')}
          >
            <Send size={16} className={dir === 'rtl' ? 'rotate-180' : ''} />
            {isTyping && pendingCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-aegis-primary px-1 text-[9px] font-bold leading-none text-white">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>

          {(isTyping || isSending || voiceOutputActive) && (
            <button
              type="button"
              onClick={() => { void onStop(); }}
              className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-aegis-danger/80 text-aegis-text transition-colors hover:bg-aegis-danger"
              title={t('input.stop')}
              aria-label={t('input.stop')}
            >
              <Square size={12} fill="currentColor" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
