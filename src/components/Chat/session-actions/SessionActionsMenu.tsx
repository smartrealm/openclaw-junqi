import { useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Archive,
  ChevronRight,
  Circle,
  Eye,
  Folder,
  GitFork,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { showConfirm } from '@/components/shared/alertStore';
import type { Session } from '@/stores/chatStore';
import { useChatStore } from '@/stores/chatStore';
import { isGatewayMainSession } from '@/utils/sessionLifecycle';
import { createNativeSession } from '@/utils/sessionCreate';
import { deleteSessionEverywhere } from '@/utils/sessionDelete';
import { useNotificationStore } from '@/stores/notificationStore';
import { SessionGroupCreateDialog } from './SessionGroupCreateDialog';
import { SessionGroupSubmenu } from './SessionGroupSubmenu';
import { sessionActionErrorKey } from '@/utils/sessionActionError';
import { debugError } from '@/utils/debugLog';

export interface SessionActionsMenuProps {
  readonly session: Session;
  readonly onDismiss: () => void;
  readonly onRequestRename: () => void;
  readonly onOpenSession?: (sessionKey: string) => void;
  readonly className?: string;
}

function agentIdForSession(session: Session): string | null {
  if (session.agentId?.trim()) return session.agentId.trim();
  return /^agent:([^:]+):/.exec(session.key)?.[1] ?? null;
}

function isUnread(session: Session): boolean {
  return (session.unread ?? 0) > 0;
}

function MenuButton({
  children,
  danger = false,
  disabled = false,
  onClick,
  onFocus,
  onMouseEnter,
  hasPopup = false,
  buttonRef,
}: {
  readonly children: ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly onFocus?: () => void;
  readonly onMouseEnter?: () => void;
  readonly hasPopup?: boolean;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-haspopup={hasPopup ? 'menu' : undefined}
      onClick={onClick}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      className={clsx(
        'flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        danger
          ? 'text-aegis-danger hover:bg-aegis-danger/10'
          : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text',
      )}
    >
      {children}
    </button>
  );
}

/**
 * 侧栏和页签共用的会话操作菜单。操作顺序与分组交互保持 OpenClaw 原生语义，
 * 行和页签继续负责导航，菜单只负责会话组织操作。
 */
export function SessionActionsMenu({
  session,
  onDismiss,
  onRequestRename,
  onOpenSession,
  className,
}: SessionActionsMenuProps) {
  const { t } = useTranslation();
  const {
    sessions,
    togglePinSession,
    setSessionUnread,
    setSessionArchived,
    setSessionCategory,
    ensureSessionGroup,
    sessionGroupCatalog,
    refreshSessionGroupCatalog,
    defaultMainSessionKey,
  } = useChatStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const isMainSession = isGatewayMainSession(session.key, defaultMainSessionKey);
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
    if (pendingAction) return;
    setPendingAction(true);
    void action()
      .then(onDismiss)
      .catch((error: unknown) => {
        debugError('app', '[SessionActionsMenu] Session action failed:', error);
        useNotificationStore.getState().addToast(
          'error',
          t('chat.sessionActions'),
          t(sessionActionErrorKey(error)),
        );
      })
      .finally(() => setPendingAction(false));
  };

  const openGroups = () => {
    if (!groupsOpen) {
      setGroupsOpen(true);
      void refreshSessionGroupCatalog().catch(() => undefined);
    }
  };

  const forkSession = async () => {
    if (pendingAction) return;
    const agentId = agentIdForSession(session);
    if (!agentId) {
      useNotificationStore.getState().addToast('error', t('chat.forkSession'), t('chat.agentUnavailable'));
      return;
    }
    setPendingAction(true);
    const result = await createNativeSession({
      agentId,
      parentSessionKey: session.key,
      fork: true,
    });
    if (result.ok) {
      onOpenSession?.(result.session.key);
      onDismiss();
      return;
    }
    debugError('app', '[SessionActionsMenu] Session fork failed:', result.error);
    useNotificationStore.getState().addToast('error', t('chat.forkSession'), t('chat.forkSessionFailed'));
    setPendingAction(false);
  };

  const createGroup = async (name: string) => {
    await ensureSessionGroup(name);
    await setSessionCategory(session.key, name);
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('chat.sessionActions')}
      className={clsx(
        'relative min-w-[228px] rounded-lg border border-aegis-menu-border bg-aegis-menu-bg py-1 text-[12px] shadow-[var(--aegis-menu-shadow)]',
        className,
      )}
    >
      <MenuButton
        disabled={pendingAction || session.archived === true}
        onClick={() => finish(() => togglePinSession(session.key))}
      >
        {session.pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}
        {session.pinned ? t('chat.unpinSession') : t('chat.pinSession')}
      </MenuButton>
      <MenuButton disabled={pendingAction} onClick={() => finish(() => setSessionUnread(session.key, !isUnread(session)))}>
        {isUnread(session) ? <Eye size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}
        {isUnread(session) ? t('chat.markSessionRead') : t('chat.markSessionUnread')}
      </MenuButton>
      <MenuButton disabled={pendingAction} onClick={() => { onRequestRename(); onDismiss(); }}>
        <Pencil size={13} aria-hidden="true" />
        {t('chat.renameSession')}
      </MenuButton>
      <MenuButton disabled={pendingAction} onClick={() => { void forkSession(); }}>
        <GitFork size={13} aria-hidden="true" />
        {t('chat.forkSession')}
      </MenuButton>
      <MenuButton
        buttonRef={groupTriggerRef}
        hasPopup
        disabled={pendingAction}
        onClick={openGroups}
        onFocus={openGroups}
        onMouseEnter={openGroups}
      >
        <Folder size={13} aria-hidden="true" />
        <span className="min-w-0 flex-1">{t('chat.moveSessionToGroup')}</span>
        <ChevronRight size={13} aria-hidden="true" />
      </MenuButton>
      <SessionGroupSubmenu
        open={groupsOpen}
        parentMenuRef={menuRef}
        triggerRef={groupTriggerRef}
        category={session.category}
        groups={sessionCategories}
        onSelect={(category) => finish(() => setSessionCategory(session.key, category))}
        onRequestCreate={() => {
          setGroupsOpen(false);
          setCreateGroupOpen(true);
        }}
      />
      <div className="my-1 border-t border-aegis-border/70" role="separator" />
      <MenuButton disabled={pendingAction} onClick={() => finish(() => setSessionArchived(session.key, !session.archived))}>
        <Archive size={13} aria-hidden="true" />
        {session.archived ? t('chat.restoreSession') : t('chat.archiveSession')}
      </MenuButton>
      {!isMainSession && (
        <MenuButton
          danger
          disabled={pendingAction}
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
      )}
      {createGroupOpen && (
        <SessionGroupCreateDialog
          onDismiss={() => setCreateGroupOpen(false)}
          onCreate={createGroup}
          onCreated={onDismiss}
        />
      )}
    </div>
  );
}
