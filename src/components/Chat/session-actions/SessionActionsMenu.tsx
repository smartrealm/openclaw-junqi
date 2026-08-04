import { useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  Check,
  ChevronRight,
  Folder,
  GitFork,
  Mail,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { showConfirm } from '@/components/shared/alertStore';
import type { Session } from '@/stores/chatStore';
import { useChatStore } from '@/stores/chatStore';
import { isAgentMainSession } from '@/utils/sessionLifecycle';
import { createNativeSession } from '@/utils/sessionCreate';
import { deleteSessionEverywhere } from '@/utils/sessionDelete';
import { resetSessionEverywhere } from '@/utils/sessionReset';
import { useNotificationStore } from '@/stores/notificationStore';

export interface SessionActionsMenuProps {
  readonly session: Session;
  readonly onDismiss: () => void;
  readonly onRequestRename: () => void;
  readonly onOpenSession?: (sessionKey: string) => void;
  readonly onCloseTab?: () => void;
  readonly className?: string;
}

function agentIdForSession(session: Session): string {
  if (session.agentId?.trim()) return session.agentId.trim();
  return /^agent:([^:]+):/.exec(session.key)?.[1] ?? 'main';
}

function MenuButton({
  children,
  danger = false,
  onClick,
}: {
  readonly children: ReactNode;
  readonly danger?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors',
        danger
          ? 'text-aegis-danger hover:bg-aegis-danger/10'
          : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text',
      )}
    >
      {children}
    </button>
  );
}

export function SessionActionsMenu({
  session,
  onDismiss,
  onRequestRename,
  onOpenSession,
  onCloseTab,
  className,
}: SessionActionsMenuProps) {
  const { t } = useTranslation();
  const {
    sessions,
    togglePinSession,
    markSessionUnread,
    setSessionArchived,
    setSessionCategory,
    ensureSessionGroup,
    sessionGroupCatalog,
    refreshSessionGroupCatalog,
  } = useChatStore();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const isMainSession = isAgentMainSession(session.key);
  const sessionCategories = useMemo(() => {
    const categories = new Map<string, string>();
    for (const category of sessionGroupCatalog) {
      const normalized = category.trim();
      if (normalized) categories.set(normalized, normalized);
    }
    for (const candidate of sessions) {
      const category = typeof candidate.category === 'string' ? candidate.category.trim() : '';
      if (category) categories.set(category, category);
    }
    return [...categories.values()];
  }, [sessionGroupCatalog, sessions]);

  const finish = (action: () => Promise<void>) => {
    void action().then(onDismiss).catch((error: unknown) => {
      useNotificationStore.getState().addToast(
        'error',
        t('chat.sessionActions'),
        error instanceof Error ? error.message : String(error),
      );
    });
  };

  const forkSession = async () => {
    const result = await createNativeSession({
      agentId: agentIdForSession(session),
      label: t('chat.forkedSessionLabel'),
      parentSessionKey: session.key,
      fork: true,
    });
    if (result.ok) {
      onOpenSession?.(result.session.key);
    } else {
      useNotificationStore.getState().addToast('error', t('chat.forkSession'), result.error);
    }
  };

  const createCategory = async () => {
    try {
      const category = newCategory.trim();
      if (!category) return;
      await ensureSessionGroup(category);
      await setSessionCategory(session.key, category);
      setNewCategory('');
      onDismiss();
    } catch (error) {
      useNotificationStore.getState().addToast(
        'error',
        t('chat.setSessionCategory'),
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <div className={clsx('min-w-[204px] rounded-lg border border-aegis-menu-border bg-aegis-menu-bg py-1 text-[12px] shadow-[var(--aegis-menu-shadow)]', className)}>
      <MenuButton onClick={() => { onRequestRename(); onDismiss(); }}>
        <Pencil size={13} aria-hidden="true" />
        {t('chat.renameSession')}
      </MenuButton>

      <>
          <MenuButton onClick={() => finish(() => togglePinSession(session.key))}>
            {session.pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}
            {session.pinned ? t('chat.unpinSession') : t('chat.pinSession')}
          </MenuButton>
          <MenuButton onClick={() => finish(() => markSessionUnread(session.key))}>
            <Mail size={13} aria-hidden="true" />
            {t('chat.markSessionUnread')}
          </MenuButton>
          <MenuButton onClick={() => { onDismiss(); void forkSession(); }}>
            <GitFork size={13} aria-hidden="true" />
            {t('chat.forkSession')}
          </MenuButton>
          <MenuButton onClick={() => {
            const nextOpen = !groupsOpen;
            setGroupsOpen(nextOpen);
            if (nextOpen) void refreshSessionGroupCatalog().catch(() => undefined);
          }}>
            <Folder size={13} aria-hidden="true" />
            <span className="min-w-0 flex-1">{t('chat.setSessionCategory')}</span>
            <ChevronRight size={13} className={clsx('transition-transform', groupsOpen && 'rotate-90')} aria-hidden="true" />
          </MenuButton>
          {groupsOpen && (
            <div className="mx-2 mb-1 rounded-md border border-aegis-border/70 bg-aegis-elevated/60 py-1">
              <MenuButton onClick={() => finish(() => setSessionCategory(session.key, null))}>
                {t('chat.clearSessionCategory')}
              </MenuButton>
              {sessionCategories.map((category) => (
                <MenuButton key={category} onClick={() => finish(() => setSessionCategory(session.key, category))}>
                  <Folder size={12} aria-hidden="true" />
                  <span className="truncate">{category}</span>
                  {session.category === category && <Check size={12} className="ml-auto" aria-hidden="true" />}
                </MenuButton>
              ))}
              <div className="mx-2 my-1 border-t border-aegis-border/70" />
              <div className="flex gap-1 px-2 pb-1">
                <input
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void createCategory();
                    if (event.key === 'Escape') setNewCategory('');
                  }}
                  placeholder={t('chat.newSessionCategoryPlaceholder')}
                  className="h-7 min-w-0 flex-1 rounded border border-aegis-border bg-aegis-bg px-2 text-[11px] text-aegis-text outline-none focus:border-aegis-primary"
                />
                <button
                  type="button"
                  onClick={() => void createCategory()}
                  disabled={!newCategory.trim()}
                  className="flex h-7 w-7 items-center justify-center rounded border border-aegis-border text-aegis-text-muted hover:border-aegis-primary hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={t('chat.setSessionCategory')}
                  title={t('chat.setSessionCategory')}
                >
                  <Check size={12} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          <MenuButton onClick={() => finish(async () => {
            await setSessionArchived(session.key, !session.archived);
            if (!session.archived) onCloseTab?.();
          })}>
            <Archive size={13} aria-hidden="true" />
            {session.archived ? t('chat.restoreSession') : t('chat.archiveSession')}
          </MenuButton>
          <div className="my-1 border-t border-aegis-border/70" />
      </>

      {onCloseTab && !isMainSession && (
        <MenuButton onClick={() => { onCloseTab(); onDismiss(); }}>
          <X size={13} aria-hidden="true" />
          {t('chat.closeTab')}
        </MenuButton>
      )}
      <MenuButton onClick={() => {
        showConfirm(t('chat.resetSession'), t('chat.resetSessionConfirm'), async () => {
          await resetSessionEverywhere(session.key);
        });
        onDismiss();
      }}>
        <RefreshCw size={13} aria-hidden="true" />
        {t('chat.resetSession')}
      </MenuButton>
      {!isMainSession && (
        <>
          <div className="my-1 border-t border-aegis-border/70" />
          <MenuButton
            danger
            onClick={() => {
              showConfirm(t('chat.deleteSession'), t('chat.deleteSessionConfirm'), async () => {
                await deleteSessionEverywhere(session.key);
              });
              onDismiss();
            }}
          >
            <Trash2 size={13} aria-hidden="true" />
            {t('chat.deleteSession')}
          </MenuButton>
        </>
      )}
    </div>
  );
}
