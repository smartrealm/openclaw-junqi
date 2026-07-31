import { Cpu, File, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CATEGORY_META, type SlashCategory } from '@/data/slashCommands';
import { cmdIcon } from '@/data/cmdIcons';
import { ComposerSuggestionPopover } from './ComposerSuggestionPopover';
import type { useComposerSuggestions } from './useComposerSuggestions';

type SuggestionController = ReturnType<typeof useComposerSuggestions>;

const SUGGESTION_LAYOUT = {
  mention: { startOffset: 64, width: 320 },
  slash: { startOffset: 12, width: 360 },
  argument: { startOffset: 64, width: 280 },
} as const;

function KeyboardHints() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 border-t border-[rgb(var(--aegis-overlay)/0.06)] px-3 py-1.5 text-[10px] text-aegis-text-dim/60">
      <span>{t('input.suggestions.navigate')}</span>
      <span>{t('input.suggestions.select')}</span>
      <span>{t('input.suggestions.close')}</span>
    </div>
  );
}

export function ComposerSuggestionMenus({
  controller,
  dir,
}: {
  controller: SuggestionController;
  dir: 'ltr' | 'rtl';
}) {
  const { t } = useTranslation();
  const {
    argumentCompletions,
    argumentPicker,
    closeArgumentPicker,
    closeMentionPicker,
    closeSlashPicker,
    groupedSlash,
    matchedSlash,
    mentionItems,
    mentionPicker,
    setArgumentPicker,
    setMentionPicker,
    setSlashPicker,
    skills,
    slashPicker,
    textareaRef,
    workspaceFiles,
  } = controller;

  return (
    <>
      {mentionPicker.open && (
        <ComposerSuggestionPopover
          open={mentionPicker.open}
          onOpenChange={(open) => { if (!open) closeMentionPicker(); }}
          dir={dir}
          textareaRef={textareaRef}
          {...SUGGESTION_LAYOUT.mention}
        >
          <div className="flex items-center gap-2 border-b border-[rgb(var(--aegis-overlay)/0.06)] px-3 py-2">
            <span className="shrink-0 font-mono text-[12px] text-aegis-text-secondary">@</span>
            <input
              autoFocus
              value={mentionPicker.query}
              onChange={(event) => setMentionPicker((state) => ({ ...state, query: event.target.value, idx: 0 }))}
              placeholder={t('input.suggestions.searchMentions')}
              className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-aegis-text outline-none placeholder:text-aegis-text-dim"
            />
            {mentionPicker.query && (
              <button
                type="button"
                onClick={() => setMentionPicker((state) => ({ ...state, query: '', idx: 0 }))}
                className="rounded p-0.5 text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.06)]"
                aria-label={t('input.suggestions.clearSearch')}
              >
                <X size={11} />
              </button>
            )}
            <span className="shrink-0 text-[10px] text-aegis-text-dim">
              {t('input.suggestions.itemCount', { count: skills.length + workspaceFiles.length })}
            </span>
          </div>
          <div className="max-h-[240px] overflow-y-auto py-0.5 scrollbar-hidden">
            {mentionItems.length > 0 ? mentionItems.map((item, index) => {
              const active = index === mentionPicker.idx;
              const description = item.kind === 'skill' ? item.description : item.path;
              const ItemIcon = item.kind === 'skill' ? Sparkles : File;
              return (
                <button
                  key={`${item.kind}:${item.kind === 'skill' ? item.name : item.path}`}
                  type="button"
                  onClick={() => controller.pickMention(item)}
                  onMouseEnter={() => setMentionPicker((state) => ({ ...state, idx: index }))}
                  className={clsx(
                    'flex w-full items-center gap-3 border-s-[3px] px-3 py-2 text-start transition-colors',
                    active
                      ? 'border-s-aegis-primary bg-[rgb(var(--aegis-primary)/0.08)] ps-[9px]'
                      : 'border-s-transparent ps-[9px] hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                  )}
                >
                  <ItemIcon size={14} className={clsx('shrink-0', active ? 'text-aegis-primary' : 'text-aegis-text-dim')} />
                  <span className="min-w-0 flex-1">
                    <span className={clsx('font-mono text-[12px]', active ? 'text-aegis-primary' : 'text-aegis-text-secondary')}>
                      @{item.name}
                    </span>
                    {description && <span className="block truncate text-[10px] text-aegis-text-dim">{description}</span>}
                  </span>
                </button>
              );
            }) : (
              <div className="px-3 py-4 text-center text-[11px] text-aegis-text-dim">
                {skills.length === 0 && workspaceFiles.length === 0
                  ? t('input.suggestions.noMentionSources')
                  : t('input.suggestions.noMatches')}
              </div>
            )}
          </div>
          <KeyboardHints />
        </ComposerSuggestionPopover>
      )}

      {slashPicker.open && matchedSlash.length > 0 && (
        <ComposerSuggestionPopover
          open={slashPicker.open}
          onOpenChange={(open) => { if (!open) closeSlashPicker(); }}
          dir={dir}
          textareaRef={textareaRef}
          {...SUGGESTION_LAYOUT.slash}
        >
          <div className="max-h-[300px] overflow-y-auto py-1 scrollbar-hidden">
            {groupedSlash.order.map((category) => {
              const meta = CATEGORY_META[category as SlashCategory];
              return (
                <div key={category}>
                  <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[9px] font-semibold uppercase text-aegis-text-dim">
                    {meta?.icon}<span>{meta?.label}</span>
                  </div>
                  {groupedSlash.groups[category]?.map((command) => {
                    const index = matchedSlash.indexOf(command);
                    const active = index === slashPicker.idx;
                    return (
                      <button
                        key={command.cmd}
                        type="button"
                        onClick={() => controller.pickSlash(command)}
                        onMouseEnter={() => setSlashPicker((state) => ({ ...state, idx: index }))}
                        className={clsx(
                          'flex w-full items-center gap-3 border-s-[3px] px-3 py-2 text-start transition-colors',
                          active
                            ? 'border-s-aegis-primary bg-[rgb(var(--aegis-primary)/0.08)] ps-[9px]'
                            : 'border-s-transparent ps-[9px] hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                        )}
                      >
                        <span className={clsx('shrink-0', active ? 'text-aegis-primary' : 'text-aegis-text-dim')}>
                          {cmdIcon(command.cmd, 14)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={clsx('font-mono text-[12px] font-semibold', active ? 'text-aegis-primary' : 'text-aegis-text-secondary')}>
                              {command.cmd}
                            </span>
                            {command.argHint && <span className="font-mono text-[10px] text-aegis-text-dim">{command.argHint}</span>}
                          </span>
                          <span className="block truncate text-[10px] text-aegis-text-dim">{command.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <KeyboardHints />
        </ComposerSuggestionPopover>
      )}

      {argumentPicker.open && argumentCompletions.length > 0 && (
        <ComposerSuggestionPopover
          open={argumentPicker.open}
          onOpenChange={(open) => { if (!open) closeArgumentPicker(); }}
          dir={dir}
          textareaRef={textareaRef}
          {...SUGGESTION_LAYOUT.argument}
        >
          <div className="flex items-center gap-2 border-b border-[rgb(var(--aegis-overlay)/0.06)] px-3 py-2">
            <span className="font-mono text-[11px] text-aegis-text-secondary">{argumentPicker.cmd}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-aegis-text">
              {argumentPicker.query || t('input.suggestions.chooseArgument')}
            </span>
            <span className="text-[10px] text-aegis-text-dim">
              {t('input.suggestions.itemCount', { count: argumentCompletions.length })}
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto py-0.5 scrollbar-hidden">
            {argumentCompletions.map((item, index) => {
              const active = index === argumentPicker.idx;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => controller.pickArgument(item)}
                  onMouseEnter={() => setArgumentPicker((state) => ({ ...state, idx: index }))}
                  className={clsx(
                    'flex w-full items-center gap-3 border-s-[3px] px-3 py-2 text-start transition-colors',
                    active
                      ? 'border-s-aegis-primary bg-[rgb(var(--aegis-primary)/0.08)] ps-[9px]'
                      : 'border-s-transparent ps-[9px] hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                  )}
                >
                  <Cpu size={14} className={clsx('shrink-0', active ? 'text-aegis-primary' : 'text-aegis-text-dim')} />
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block truncate font-mono text-[12px]', active ? 'text-aegis-primary' : 'text-aegis-text-secondary')}>
                      {item.label}
                    </span>
                    {item.label !== item.value && <span className="block truncate font-mono text-[10px] text-aegis-text-dim">{item.value}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </ComposerSuggestionPopover>
      )}
    </>
  );
}
