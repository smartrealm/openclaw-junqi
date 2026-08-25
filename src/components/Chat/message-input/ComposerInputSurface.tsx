import { AtSign, Camera, Mic, Paperclip, Plus, Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ComposerActionMenu, ComposerActionMenuItem } from './ComposerActionMenu';
import { ComposerSuggestionMenus } from './ComposerSuggestionMenus';
import type { useComposerAttachments } from '@/hooks/chat/useComposerAttachments';
import type { useComposerMenu } from './useComposerMenu';
import type { useComposerSuggestions } from '@/hooks/chat/useComposerSuggestions';
import {
  resolveComposerPrimaryAction,
  type ComposerPrimaryActionLabel,
} from './composerPrimaryAction';
import type { OpenClawQueueMode } from '@/services/gateway/OpenClawQueueMode';
import { ComposerPrimaryActionButton } from './ComposerPrimaryActionButton';

interface ComposerInputSurfaceProps {
  activeSessionKey: string;
  dir: 'ltr' | 'rtl';
  connected: boolean;
  historyLoading: boolean;
  text: string;
  responseActive: boolean;
  isSending: boolean;
  effectiveQueueMode?: OpenClawQueueMode;
  stopError: string | null;
  attachments: ReturnType<typeof useComposerAttachments>;
  suggestions: ReturnType<typeof useComposerSuggestions>;
  menu: ReturnType<typeof useComposerMenu>;
  talkActive: boolean;
  onStartRecording: () => void;
  onToggleTalk: () => void;
  onSend: (queueModeOverride?: OpenClawQueueMode) => Promise<void>;
  onStop: () => Promise<void>;
}

export function ComposerInputSurface({
  activeSessionKey,
  dir,
  connected,
  historyLoading,
  text,
  responseActive,
  isSending,
  effectiveQueueMode,
  stopError,
  attachments,
  suggestions,
  menu,
  talkActive,
  onStartRecording,
  onToggleTalk,
  onSend,
  onStop,
}: ComposerInputSurfaceProps) {
  const { t } = useTranslation();
  const disabled = !connected || historyLoading;
  const canSend = Boolean(text.trim() || attachments.files.length > 0);
  const primaryAction = resolveComposerPrimaryAction({
    hasContent: canSend,
    responseActive,
    sendDisabled: disabled || isSending,
    effectiveQueueMode,
  });
  const actionLabels: Record<ComposerPrimaryActionLabel, string> = {
    send: historyLoading ? t('input.historyLoading') : t('input.send'),
    stop: t('input.stop'),
    steer: t('input.steer'),
    queue: t('input.queue'),
    interrupt: t('input.interruptAndSend'),
  };
  const actionLabel = actionLabels[primaryAction.label];

  return (
    <div data-tour="chat-composer" className="mx-auto flex w-full max-w-[784px] min-w-0 items-end gap-2 px-3 pb-3 pt-2" dir={dir}>
      <div
        className={clsx(
          'relative flex flex-1 flex-col gap-1 rounded-xl border border-aegis-border bg-aegis-surface px-2.5 py-2 shadow-sm',
          'transition-[border-color,box-shadow,background-color] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] motion-reduce:transition-none focus-within:border-aegis-primary/35',
          'focus-within:shadow-[0_0_0_3px_rgb(var(--aegis-primary)/0.06)]',
          !connected && 'opacity-40',
        )}
        onDrop={attachments.drop}
        onDragOver={(event) => event.preventDefault()}
      >
        <div className="flex min-w-0 w-full items-end gap-1.5">
          <ComposerActionMenu
            open={menu.active === 'add'}
            onOpenChange={(open) => menu.setOpen('add', open)}
            dir={dir}
            align="start"
            ariaLabel={t('input.addContent')}
            trigger={(
              <button
                type="button"
                disabled={disabled}
                className={clsx(
                  'grid size-[34px] shrink-0 place-items-center rounded-lg transition-colors motion-reduce:transition-none',
                  menu.active === 'add'
                    ? 'bg-aegis-primary/12 text-aegis-primary'
                    : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-30',
                )}
                title={t('input.addContent')}
                aria-label={t('input.addContent')}
              >
                <Plus size={17} />
              </button>
            )}
          >
            <ComposerActionMenuItem
              icon={Paperclip}
              onSelect={() => { menu.close(); void attachments.selectFiles(); }}
            >
              {t('input.attachFile')}
            </ComposerActionMenuItem>
            <ComposerActionMenuItem
              icon={Camera}
              onSelect={() => { menu.close(); attachments.setScreenshotSessionKey(activeSessionKey); }}
            >
              {t('input.screenshot')}
            </ComposerActionMenuItem>
          </ComposerActionMenu>

          <button
            type="button"
            onClick={suggestions.openMentions}
            disabled={!connected || suggestions.skills.length === 0}
            className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-[rgb(var(--aegis-overlay)/0.03)] text-aegis-text-muted transition-colors motion-reduce:transition-none hover:bg-[rgb(var(--aegis-overlay)/0.07)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-30"
            title={t('input.skills')}
            aria-label={t('input.skills')}
          >
            <AtSign size={16} />
          </button>

          <ComposerSuggestionMenus controller={suggestions} dir={dir} />
          <textarea
            ref={suggestions.textareaRef}
            data-input="message"
            rows={1}
            value={text}
            onChange={suggestions.onChange}
            onCompositionStart={() => { suggestions.composingRef.current = true; }}
            onCompositionEnd={() => { window.setTimeout(() => { suggestions.composingRef.current = false; }, 0); }}
            onKeyDown={(event) => suggestions.onKeyDown(
              event,
              responseActive,
              (queueModeOverride) => { void onSend(queueModeOverride); },
            )}
            onPaste={attachments.paste}
            placeholder={historyLoading
              ? t('input.placeholderHistoryLoading')
              : connected ? t('input.placeholderSlash') : t('input.placeholderDisconnected')}
            className="max-h-[180px] min-w-0 flex-1 resize-none border-none bg-transparent px-1.5 py-2 text-[14px] leading-[1.35] text-aegis-text placeholder:text-aegis-text-muted focus:outline-none focus-visible:shadow-none scrollbar-hidden"
            dir={dir}
          />

          <ComposerActionMenu
            open={menu.active === 'voice'}
            onOpenChange={(open) => {
              if (!talkActive) menu.setOpen('voice', open);
            }}
            dir={dir}
            align="end"
            ariaLabel={t('input.voiceInputMenu')}
            trigger={(
              <button
                type="button"
                onClick={(event) => {
                  if (!talkActive) return;
                  event.preventDefault();
                  onToggleTalk();
                }}
                disabled={disabled}
                className={clsx(
                  'relative grid size-[34px] shrink-0 place-items-center rounded-lg transition-colors motion-reduce:transition-none',
                  talkActive || menu.active === 'voice'
                    ? 'bg-aegis-primary/12 text-aegis-primary hover:bg-aegis-primary/18'
                    : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-30',
                )}
                title={talkActive ? t('input.jarvisStop') : t('input.voiceInput')}
                aria-label={talkActive ? t('input.jarvisStop') : t('input.voiceInput')}
              >
                <Mic size={16} />
                {talkActive && <span className="absolute end-1 top-1 size-1.5 rounded-full bg-aegis-primary ring-2 ring-aegis-surface" />}
              </button>
            )}
          >
            <ComposerActionMenuItem icon={Mic} onSelect={onStartRecording}>
              {t('input.recordVoice')}
            </ComposerActionMenuItem>
            <ComposerActionMenuItem icon={Radio} onSelect={onToggleTalk}>
              {t('input.jarvisTalk')}
            </ComposerActionMenuItem>
          </ComposerActionMenu>

          <ComposerPrimaryActionButton
            action={primaryAction}
            canSend={canSend}
            dir={dir}
            label={actionLabel}
            onSend={() => { void onSend(); }}
            onStop={() => { void onStop(); }}
          />
        </div>
        {stopError && (
          <p className="px-1.5 pt-1 text-xs text-aegis-danger" role="alert">
            {stopError}
          </p>
        )}
      </div>
    </div>
  );
}
