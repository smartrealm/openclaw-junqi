import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Send, Paperclip, Camera, Mic, X, Square, Clock, ChevronDown, ChevronUp, Check, Trash2, Pencil, Sparkles, Cpu, Eye, File, FileText, FileSpreadsheet, FileArchive, Music, Film, FileJson, Radio, RefreshCw, Plus, AtSign } from 'lucide-react';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { useVoiceWake } from '@/hooks/useVoiceWake';
import { Icon } from '@/components/shared/icons';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chatStore';
import { ensureGroupFresh, useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { gateway } from '@/services/gateway';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { chatSendCoordinator } from '@/services/chat/sendTransaction';
import {
  AttachmentValidationError,
  createPreparedAttachment,
  displayAttachments,
  toGatewayAttachments,
  validatePreparedAttachments,
} from '@/services/chat/attachments';
import type { PreparedAttachment, QueuedChatMessage } from '@/services/chat/types';
import { getDirection } from '@/i18n';
import { SLASH_COMMANDS, CATEGORY_META, type SlashCommand, type SlashCategory } from '@/data/slashCommands';
import { cmdIcon } from '@/data/cmdIcons';
import clsx from 'clsx';

import { formatBytes } from '@/utils/format';
import { debugError } from '@/utils/debugLog';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { resetSessionEverywhere } from '@/utils/sessionReset';

const ScreenshotPicker = lazy(() => import('./ScreenshotPicker').then((m) => ({ default: m.ScreenshotPicker })));
const VoiceRecorder = lazy(() => import('./VoiceRecorder').then((m) => ({ default: m.VoiceRecorder })));

// ═══════════════════════════════════════════════════════════
// Message Input — premium input with attachments
// ═══════════════════════════════════════════════════════════

// Stable empty-array reference for the queue selector — returning a fresh `[]`
// literal from a zustand selector breaks useSyncExternalStore's referential
// equality check and triggers an infinite re-render loop.
const EMPTY_QUEUE: QueuedChatMessage[] = [];
// Stable empty reference for `draftAttachments[k] ?? ...` selectors. Using a
// fresh `[]` inline allocates a new array per render and trips React #185
// when the consumer wires the result into a useEffect dep.
const EMPTY_PATHS: string[] = [];
const EMPTY_PREPARED_ATTACHMENTS: PreparedAttachment[] = [];

function estimateWavDuration(base64: string): number {
  try {
    const raw = atob(base64);
    if (raw.length < 44) return 0;
    const view = new DataView(Uint8Array.from(raw, (char) => char.charCodeAt(0)).buffer);
    const channels = view.getUint16(22, true) || 1;
    const sampleRate = view.getUint32(24, true) || 16_000;
    const bits = view.getUint16(34, true) || 16;
    const dataBytes = view.getUint32(40, true) || Math.max(0, raw.length - 44);
    return Math.max(0, Math.round(dataBytes / Math.max(1, sampleRate * channels * (bits / 8))));
  } catch {
    return 0;
  }
}

export function MessageInput() {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const runtimeLanguage = String(language);
  const dir = getDirection(language);
  const {
    setIsSending,
    connected,
    setIsTyping,
    isTyping,
    activeSessionKey,
    messages,
    historyLoader,
  } = useChatStore();
  const isSending = useChatStore((state) => Boolean(state.sendingBySession[activeSessionKey]));
  const isLoadingHistory = useChatStore((state) => Boolean(state.loadingHistoryBySession[activeSessionKey]));
  const isHistoryWarmupGate = connected && messages.length === 0 && isLoadingHistory;
  const voicePhase = useVoiceStore((state) => state.phase);
  const voiceSessionKey = useVoiceStore((state) => state.sessionKey);
  const remoteVoiceOutput = useVoiceStore((state) => state.remoteOutput);
  const voiceOutputActive = remoteVoiceOutput !== null
    || ((voicePhase === 'queued' || voicePhase === 'speaking')
      && (voiceSessionKey == null || voiceSessionKey === activeSessionKey));
  const clearQueue = useChatStore((s) => s.clearQueue);
  const queue = useChatStore((s) => s.messageQueue[activeSessionKey] || EMPTY_QUEUE);
  const activeSessionId = useChatStore(
    (s) => s.sessions.find((session) => session.key === activeSessionKey)?.sessionId,
  );
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage);
  const updateQueuedMessage = useChatStore((s) => s.updateQueuedMessage);
  const retryQueuedMessage = useChatStore((s) => s.retryQueuedMessage);
  const pendingCount = queue.length;
  const text = useChatStore((s) => s.drafts[activeSessionKey] || '');
  const files = useChatStore(
    (s) => s.preparedAttachments[activeSessionKey] ?? EMPTY_PREPARED_ATTACHMENTS,
  );
  const setText = useCallback((next: React.SetStateAction<string>) => {
    const state = useChatStore.getState();
    const current = state.drafts[activeSessionKey] || '';
    state.setDraft(activeSessionKey, typeof next === 'function' ? next(current) : next);
  }, [activeSessionKey]);
  const updateSessionFiles = useCallback((
    sessionKey: string,
    next: React.SetStateAction<PreparedAttachment[]>,
  ) => {
    const state = useChatStore.getState();
    const current = state.preparedAttachments[sessionKey] ?? [];
    const resolved = typeof next === 'function' ? next(current) : next;
    validatePreparedAttachments(resolved);
    state.setPreparedAttachments(sessionKey, resolved);
  }, []);
  const setFiles = useCallback((next: React.SetStateAction<PreparedAttachment[]>) => {
    updateSessionFiles(activeSessionKey, next);
  }, [activeSessionKey, updateSessionFiles]);
  const reportAttachmentError = useCallback((error: unknown) => {
    debugError('media', '[Attachments] Unable to prepare attachment:', error);
    showAlert(
      t('input.attachmentErrorTitle', '附件读取失败'),
      error instanceof Error ? error.message : String(error),
      'error',
    );
  }, [t]);
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [composerMenu, setComposerMenu] = useState<'add' | 'voice' | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null); // image preview URL
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const voiceMenuRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const sendVoicePayload = useCallback(async (base64: string, mimeType: string, durationSec: number, previewUrl: string) => {
    if (!connected || isHistoryWarmupGate || !base64) return;
    const sendSessionKey = activeSessionKey;
    const sendSessionId = activeSessionId;
    setVoiceMode(false);
    voiceRuntime.interruptGlobally(sendSessionKey);
    const clientMessageId = createClientMessageId();
    setIsSending(true, sendSessionKey);
    try {
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm';
      const filename = `voice-${Date.now()}.${ext}`;
      // Local persistence supports retention and recovery. Gateway may run in
      // Docker or on another host, so transport must never depend on this path.
      await window.aegis?.voice?.save?.(filename, base64, sendSessionKey).catch(() => null);
      const attachments = toGatewayAttachments([createPreparedAttachment({
        fileName: filename,
        mimeType,
        base64,
        size: Math.floor(base64.length * 0.75),
      })]);
      await chatSendCoordinator.send({
        sessionKey: sendSessionKey,
        sessionId: sendSessionId,
        clientMessageId,
        message: t('voice.voiceMessage', { seconds: durationSec }),
        attachments,
        optimisticMessage: { mediaUrl: previewUrl, mediaType: 'audio' },
      });
    } catch (err) {
      debugError('media', '[Voice] Send error:', err);
      if (err instanceof AttachmentValidationError) reportAttachmentError(err);
    } finally {
      setIsSending(false, sendSessionKey);
    }
  }, [activeSessionKey, activeSessionId, connected, isHistoryWarmupGate, reportAttachmentError, setIsSending, t]);

  const handleVoiceWakeCapture = useCallback(async (wavDataUrl: string) => {
    const base64 = wavDataUrl.split(',')[1] || '';
    if (!base64) return;
    await sendVoicePayload(base64, 'audio/wav', estimateWavDuration(base64), wavDataUrl);
  }, [sendVoicePayload]);

  const handleVoiceTranscript = useCallback((transcript: string) => {
    voiceRuntime.interruptGlobally(activeSessionKey);
    setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    textareaRef.current?.focus();
  }, [activeSessionKey]);

  const handleVoiceWakeDetected = useCallback(() => {
    voiceRuntime.interruptGlobally(activeSessionKey);
    if (useChatStore.getState().typingBySession[activeSessionKey]) {
      void gateway.abortChat(activeSessionKey).catch(() => undefined);
    }
  }, [activeSessionKey]);

  // Browser recognition is used when available. Native VAD captures a WAV on
  // platforms without Web Speech; that WAV is sent through the same voice path.
  const voiceWake = useVoiceWake({
    onTranscript: handleVoiceTranscript,
    onCaptureFallback: handleVoiceWakeCapture,
    onWakeDetected: handleVoiceWakeDetected,
    lang: runtimeLanguage === 'zh-TW' ? 'zh-TW' : runtimeLanguage === 'zh' ? 'zh-CN' : runtimeLanguage === 'ar' ? 'ar-SA' : 'en-US',
    sessionKey: activeSessionKey,
  });

  const stopActiveAssistantForVoiceInput = useCallback(async () => {
    voiceRuntime.interruptGlobally(activeSessionKey);
    if (useChatStore.getState().typingBySession[activeSessionKey]) {
      await gateway.abortChat(activeSessionKey).catch((error) => {
        debugError('gateway', '[Voice] Unable to stop active response:', error);
      });
    }
  }, [activeSessionKey]);

  const startVoiceRecording = useCallback(() => {
    void (async () => {
      setComposerMenu(null);
      if (voiceWake.enabled || voiceWake.error) await voiceWake.stop();
      await stopActiveAssistantForVoiceInput();
      setVoiceMode(true);
    })();
  }, [stopActiveAssistantForVoiceInput, voiceWake.enabled, voiceWake.error, voiceWake.stop]);

  const toggleDictation = useCallback(() => {
    void (async () => {
      setComposerMenu(null);
      if (voiceWake.enabled) {
        await voiceWake.stop();
        textareaRef.current?.focus();
        return;
      }
      await stopActiveAssistantForVoiceInput();
      await voiceWake.start();
      textareaRef.current?.focus();
    })();
  }, [stopActiveAssistantForVoiceInput, voiceWake.enabled, voiceWake.start, voiceWake.stop]);

  const dictationStatus = voiceWake.phase === 'transcribing' || voiceWake.phase === 'wake_detected'
    ? t('input.dictationProcessing', '正在识别语音…')
    : t('input.dictationListening', '正在听写');

  useEffect(() => {
    if (!composerMenu) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (addMenuRef.current?.contains(target) || voiceMenuRef.current?.contains(target)) return;
      setComposerMenu(null);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [composerMenu]);

  useEffect(() => {
    setComposerMenu(null);
  }, [activeSessionKey]);
  // Queue strip UI states
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [editingQueueIdx, setEditingQueueIdx] = useState<number | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');
  const [confirmingDeleteIdx, setConfirmingDeleteIdx] = useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // ── Slash command picker (/) — triggered by typing '/' at line start ──
  const [slashPicker, setSlashPicker] = useState<{ open: boolean; query: string; idx: number }>({ open: false, query: '', idx: 0 });

  // ── Skills picker (@) + ✨ button — triggered by typing '@' or clicking sparkles ──
  const [allSkills, setAllSkills] = useState<Array<{ name: string; description?: string }>>([]);
  // Workspace files for @ file mention. Fetched lazily on first `@` keystroke
  // (cheaper than eagerly loading on mount), then refreshed in the background.
  // Path comes from the active configured workspace, resolved natively.
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [workspaceFilesLoaded, setWorkspaceFilesLoaded] = useState(false);
  const [atPicker, setAtPicker] = useState<{ open: boolean; query: string; idx: number }>({ open: false, query: '', idx: 0 });

  // Drain draft attachments (populated by App.tsx drag-drop into a fresh
  // session) into the local `files` list.
  //
  // CRITICAL: NEVER write `?? []` directly in the selector — that
  // allocates a fresh array on every render. React compares effect deps
  // with Object.is, so a new `[]` reference on every render triggers the
  // effect to re-fire; the effect then calls setDraftAttachments which
  // re-renders the component → loop. That was React error #185 on the
  // "New Session" path. The fix is a stable EMPTY constant.
  const draftAttach = useChatStore((s) => s.draftAttachments[activeSessionKey] ?? EMPTY_PATHS);
  useEffect(() => {
    if (draftAttach.length === 0) return;
    // Snapshot the paths BEFORE we clear so the dependency closure is
    // stable for this run even if the store changes mid-effect.
    const sessionKey = activeSessionKey;
    const paths = [...draftAttach];
    useChatStore.getState().setDraftAttachments(sessionKey, []);
    void Promise.all(paths.map(async (path) => {
      const file = await window.aegis?.file?.read(path);
      if (!file) throw new Error(`Unable to read ${path}`);
      return createPreparedAttachment({
        fileName: file.name,
        mimeType: file.mimeType,
        base64: file.base64,
        size: file.size,
        preview: file.isImage ? `data:${file.mimeType};base64,${file.base64}` : undefined,
        sourcePath: path,
      });
    })).then((additions) => {
      updateSessionFiles(sessionKey, (current) => {
        const seen = new Set(current.map((file) => file.sourcePath || file.id));
        return [...current, ...additions.filter((file) => !seen.has(file.sourcePath || file.id))];
      });
    }).catch(reportAttachmentError);
  }, [activeSessionKey, draftAttach, reportAttachmentError, updateSessionFiles]);
  useEffect(() => {
    if (!connected) return;
    gateway.getSkills().then((r: any) => {
      const skills = (r?.skills || []).filter((s: any) => s.userInvocable && s.eligible && !s.disabled);
      setAllSkills(skills.map((s: any) => ({ name: s.name, description: s.description })));
    }).catch(() => {});
  }, [connected]);

  /**
   * Lazily load workspace files via `get_workspace_path` + `list_project_files`.
   * Called when the @ picker first opens. Cached for the session — re-fetched
   * when the user clears cache via `clear_at_files` keyboard shortcut.
   */
  const ensureWorkspaceFilesLoaded = useCallback(async () => {
    if (workspaceFilesLoaded) return;
    try {
      const workspacePath = await invoke<string>('get_workspace_path');
      const files = await invoke<string[]>('list_project_files', { projectPath: workspacePath });
      setWorkspaceFiles(
        (files ?? []).map((p) => {
          const name = p.split('/').pop() ?? p;
          return { name, path: p };
        }),
      );
      setWorkspaceFilesLoaded(true);
    } catch {
      // Workspace not initialized yet, or list failed — leave files empty.
      // The @ picker will just show skills, which is a graceful fallback.
    }
  }, [workspaceFilesLoaded]);

  const clearWorkspaceFiles = useCallback(() => {
    setWorkspaceFiles([]);
    setWorkspaceFilesLoaded(false);
  }, []);

  // ── Slash commands (built-in only, no skills) ──
  const slashCommands = SLASH_COMMANDS.filter((c) => c.cmd !== '/skill:');

  const matchedSlash = slashPicker.open ? slashCommands.filter((c) => {
    const q = slashPicker.query.toLowerCase();
    return !q || c.cmd.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
  }).slice(0, 12) : [];

  const groupedSlash = (() => {
    const groups: Record<string, SlashCommand[]> = {};
    const order: string[] = [];
    for (const cmd of matchedSlash) {
      if (!groups[cmd.category]) { groups[cmd.category] = []; order.push(cmd.category); }
      groups[cmd.category].push(cmd);
    }
    return { groups, order };
  })();

  const pickSlash = (cmd: SlashCommand) => {
    if (cmd.local) {
      setText('');
      setSlashPicker({ open: false, query: '', idx: 0 });
      if (cmd.localAction === 'clear') {
        showConfirm(
          t('chat.resetSession', 'Reset session'),
          t('chat.resetSessionConfirm', 'Clear this session history? The session itself will remain.'),
          () => { void resetSessionEverywhere(activeSessionKey); },
        );
      } else if (cmd.localAction === 'compress') {
        void gateway.compactSession(activeSessionKey).catch((error) => {
          debugError('gateway', '[Chat] Session compaction failed:', error);
        });
      } else if (cmd.localAction === 'new') {
        window.dispatchEvent(new Event('aegis:open-new-session-picker'));
      }
    } else {
      // Insert command text and keep picker open if command has args (for second-level completion)
      const injected = cmd.argHint ? `${cmd.cmd} ` : `${cmd.cmd} `;
      setText(injected);
      setSlashPicker({ open: false, query: '', idx: 0 });
    }
    textareaRef.current?.focus();
  };

  // ── Skills + Workspace files picker (@) ──
  // Merged into a single list: skills first (most relevant for @ invocation),
  // then files (for @-file mention). Each item tagged with `kind` so the
  // picker can render the right icon.
  type AtItem =
    | { kind: 'skill'; name: string; description?: string }
    | { kind: 'file'; name: string; path: string };

  // Lazy-load workspace files when picker opens. The check is racy-but-cheap:
  // we use a ref-free pattern (workspaceFilesLoaded) so the effect only fires
  // once per session unless the user clears.
  useEffect(() => {
    if (atPicker.open && !workspaceFilesLoaded) {
      void ensureWorkspaceFilesLoaded();
    }
  }, [atPicker.open, workspaceFilesLoaded, ensureWorkspaceFilesLoaded]);

  const matchedAtItems: AtItem[] = atPicker.open
    ? (() => {
        const q = atPicker.query.toLowerCase();
        const skillHits: AtItem[] = allSkills
          .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
          .slice(0, 8)
          .map((s) => ({ kind: 'skill' as const, name: s.name, description: s.description }));
        const fileHits: AtItem[] = workspaceFiles
          .filter((f) => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
          .slice(0, 8)
          .map((f) => ({ kind: 'file' as const, name: f.name, path: f.path }));
        // Skills first, then files (each capped independently so neither dominates).
        return [...skillHits, ...fileHits];
      })()
    : [];

  // ── Input history (ArrowUp/Down when input is empty) ──
  const userMessageHistory = (() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'user') continue;
      const raw = messages[i].content;
      const content = typeof raw === 'string' ? raw.trim() : '';
      if (content && !seen.has(content)) {
        seen.add(content);
        history.push(content);
      }
    }
    return history;
  })();
  const [historyIdx, setHistoryIdx] = useState(-1); // -1 = not in history mode
  // Reset history idx when messages change or session changes
  useEffect(() => { setHistoryIdx(-1); }, [activeSessionKey, messages.length]);

  // ── Second-level: argument completion for /model (model list) ──
  const availableModels = useChatStore((s) => s.availableModels);
  const [argPicker, setArgPicker] = useState<{ open: boolean; cmd: string; query: string; idx: number }>({ open: false, cmd: '', query: '', idx: 0 });

  const argCompletions = (() => {
    if (!argPicker.open) return [];
    const q = argPicker.query.toLowerCase();
    // /model → dynamic model list from availableModels
    if (argPicker.cmd === '/model') {
      return availableModels.filter((m) => {
        return !q || m.id.toLowerCase().includes(q) || (m.alias || '').toLowerCase().includes(q);
      }).slice(0, 10).map((m) => ({ value: m.id, label: m.alias || m.id }));
    }
    // Commands with static argChoices
    const cmd = slashCommands.find((c) => c.cmd === argPicker.cmd);
    if (cmd?.argChoices) {
      return cmd.argChoices
        .filter((v) => !q || v.toLowerCase().includes(q))
        .slice(0, 12)
        .map((v) => ({ value: v, label: v }));
    }
    return [];
  })();

  // Clamp picker idx when filtered lists change (after all declarations)
  useEffect(() => { setSlashPicker((s) => ({ ...s, idx: Math.min(s.idx, Math.max(0, matchedSlash.length - 1)) })); }, [matchedSlash.length]);
  useEffect(() => { setAtPicker((s) => ({ ...s, idx: Math.min(s.idx, Math.max(0, matchedAtItems.length - 1)) })); }, [matchedAtItems.length]);
  useEffect(() => { setArgPicker((s) => ({ ...s, idx: Math.min(s.idx, Math.max(0, argCompletions.length - 1)) })); }, [argCompletions.length]);

  const pickSkill = (skill: { name: string }) => {
    const el = textareaRef.current;
    const injected = `@${skill.name} `;
    const before = text.slice(0, (el?.selectionStart ?? 0));
    const after = text.slice((el?.selectionStart ?? 0));
    // Replace the '@query' at cursor position with '@skillname '
    const lastAt = before.lastIndexOf('@');
    const newText = lastAt >= 0 ? before.slice(0, lastAt) + injected + after : injected + after;
    setText(newText);
    setAtPicker({ open: false, query: '', idx: 0 });
    el?.focus();
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(el.scrollHeight, 180);
    el.style.height = newHeight + 'px';
  }, [text]);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  useEffect(() => {
    const focusComposer = () => textareaRef.current?.focus();
    window.addEventListener('aegis:focus-composer', focusComposer);
    return () => window.removeEventListener('aegis:focus-composer', focusComposer);
  }, []);

  // ── Auto-resize textarea ──
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const resize = () => {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    };
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [text]);

  // ── Wait timer for queue strip header ──

  // ── ESC: abort the AI reply, or recall the last sent user message back to the input ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (composerMenu) {
        e.preventDefault();
        setComposerMenu(null);
        textareaRef.current?.focus();
        return;
      }
      const st = useChatStore.getState();

      // ESC #1 — AI is replying: abort the current response (works from anywhere).
      const voice = useVoiceStore.getState();
      const voiceActive = voice.remoteOutput !== null
        || ((voice.phase === 'queued' || voice.phase === 'speaking')
          && (voice.sessionKey == null || voice.sessionKey === activeSessionKey));
      if (st.typingBySession[activeSessionKey] || voiceActive) {
        e.preventDefault();
        voiceRuntime.interruptGlobally(activeSessionKey);
        if (st.typingBySession[activeSessionKey]) {
          gateway.abortChat(activeSessionKey).catch(() => {});
          st.clearQueue(activeSessionKey);
          st.setIsTyping(false, activeSessionKey);
        }
        return;
      }

      // ESC #2 — input focused: copy the last user message back into the
      // session-scoped composer. The Gateway transcript remains authoritative.
      if (document.activeElement !== textareaRef.current) return;
      const msgs = st.messagesPerSession[activeSessionKey] ?? [];
      let lastUserIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx === -1) return;
      e.preventDefault();
      const lastUserMsg = msgs[lastUserIdx];
      setText(lastUserMsg.content);
      textareaRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSessionKey, composerMenu]);

  const [waitSeconds, setWaitSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (queue.length === 0 || !queue[0]?.timestamp) { setWaitSeconds(null); return; }
    const tick = () => setWaitSeconds(Math.floor((Date.now() - new Date(queue[0].timestamp).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [queue.length, queue[0]?.timestamp]);

  // Reset queue-strip UI state when the queue drains/clears so it doesn't
  // carry over (expanded, mid-edit, confirm) into the next batch of queued items.
  useEffect(() => {
    if (queue.length === 0) {
      setQueueExpanded(false);
      setConfirmingClear(false);
      setEditingQueueIdx(null);
      setEditingQueueText('');
      setConfirmingDeleteIdx(null);
    }
  }, [queue.length]);

  const handleSend = useCallback(async () => {
    const sendSessionKey = activeSessionKey;
    const sendSessionId = activeSessionId;
    const sendFiles = [...files];
    const rawText = textareaRef.current?.value ?? text;
    const trimmed = rawText.trim();
    if ((!trimmed && sendFiles.length === 0) || isSending || !connected || isHistoryWarmupGate) return;

    if (messages.length === 0 && historyLoader) {
      try {
        await historyLoader(sendSessionKey);
      } catch (error) {
        debugError('app', '[Send] History warmup failed:', error);
        showAlert(
          t('chat.historyLoadFailed', '历史记录加载失败'),
          error instanceof Error ? error.message : String(error),
          'error',
        );
        return;
      }
    }

    let attachmentsForGateway;
    try {
      attachmentsForGateway = toGatewayAttachments(sendFiles);
    } catch (error) {
      showAlert(
        t('input.attachmentErrorTitle', '附件无法发送'),
        error instanceof Error ? error.message : String(error),
        'error',
      );
      return;
    }

    const fullMessage = trimmed || `📎 ${sendFiles.map((file) => file.fileName).join(', ')}`;
    const previewImageAttachments = displayAttachments(sendFiles);

    const clientMessageId = createClientMessageId();
    const timestamp = new Date().toISOString();
    setIsSending(true, sendSessionKey);

    try {
      const { budgetLimit } = useSettingsStore.getState();
      if (budgetLimit > 0) {
        await ensureGroupFresh('cost');
        const costSummary = useGatewayDataStore.getState().costSummary;
        const used = costSummary?.totals?.totalCost ?? 0;
        if (used >= budgetLimit) {
          showAlert(
            t('chat.budgetExceededTitle', '已达预算上限'),
            t('chat.budgetExceededDesc', {
              used: used.toFixed(2),
              limit: budgetLimit.toFixed(2),
              defaultValue: `近 30 天已花费 $${used.toFixed(2)}，达到上限 $${budgetLimit.toFixed(2)}。请在设置中调高预算或暂停使用。`,
            }),
            'warning',
          );
          return;
        }
      }

      voiceRuntime.interruptGlobally(sendSessionKey);
      await chatSendCoordinator.send({
        sessionKey: sendSessionKey,
        sessionId: sendSessionId,
        message: fullMessage,
        clientMessageId,
        attachments: attachmentsForGateway.length ? attachmentsForGateway : undefined,
        displayAttachments: previewImageAttachments,
        optimisticMessage: { timestamp },
      });
      const state = useChatStore.getState();
      state.setDraft(sendSessionKey, '');
      state.setPreparedAttachments(sendSessionKey, []);
      state.setQuickReplies([], sendSessionKey);
    } catch (error) {
      debugError('app', '[Send] Error:', error);
    } finally {
      setIsSending(false, sendSessionKey);
    }
  }, [
    text,
    files,
    isSending,
    connected,
    activeSessionKey,
    activeSessionId,
    setIsSending,
    messages,
    historyLoader,
    isHistoryWarmupGate,
    t,
  ]);

  // File type icon based on MIME type (uses Icon.chat.attachment palette)
  const getFileIcon = (mimeType: string): React.ReactNode => {
    if (mimeType.startsWith('image/')) return Icon.chat.attachment.image;
    if (mimeType === 'application/pdf') return Icon.chat.attachment.pdf;
    if (mimeType.startsWith('text/csv') || mimeType.includes('spreadsheet')) return Icon.chat.attachment.sheet;
    if (mimeType.includes('wordprocessing') || mimeType.includes('msword')) return Icon.chat.attachment.document;
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return Icon.chat.attachment.document;
    if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return Icon.chat.attachment.archive;
    if (mimeType.startsWith('audio/')) return Icon.chat.attachment.audio;
    if (mimeType.startsWith('video/')) return Icon.chat.attachment.video;
    if (mimeType.startsWith('text/')) return Icon.chat.attachment.document;
    return Icon.chat.attachment.generic;
  };

  const handleFileSelect = async () => {
    const sessionKey = activeSessionKey;
    try {
      const result = await window.aegis?.file.openDialog();
      if (result?.canceled || !result?.filePaths?.length) return;
      const additions = (await Promise.all(result.filePaths.map(async (filePath) => {
        const file = await window.aegis.file.read(filePath);
        if (!file) throw new Error(`Unable to read ${filePath}`);
        return createPreparedAttachment({
          fileName: file.name,
          mimeType: file.mimeType,
          base64: file.base64,
          size: file.size,
          preview: file.isImage ? `data:${file.mimeType};base64,${file.base64}` : undefined,
          sourcePath: filePath,
        });
      })));
      updateSessionFiles(sessionKey, (current) => [...current, ...additions]);
    } catch (error) {
      reportAttachmentError(error);
    }
  };

  const handleScreenshotCapture = (dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    try {
      setFiles((prev) => [...prev, createPreparedAttachment({
        fileName: `screenshot-${Date.now()}.png`,
        base64,
        mimeType: 'image/png',
        size: Math.floor(base64.length * 0.75),
        preview: dataUrl,
      })]);
    } catch (error) {
      reportAttachmentError(error);
      return;
    }
    textareaRef.current?.focus();
  };

  const handleVoiceSend = useCallback((base64: string, mimeType: string, durationSec: number, previewUrl: string) => {
    void sendVoicePayload(base64, mimeType, durationSec, previewUrl);
  }, [sendVoicePayload]);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const sessionKey = activeSessionKey;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            if (typeof reader.result !== 'string') throw new Error('Clipboard image could not be read');
            const dataUrl = reader.result;
            const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
            updateSessionFiles(sessionKey, (prev) => [...prev, createPreparedAttachment({
              fileName: 'clipboard.png',
              base64,
              mimeType: 'image/png',
              size: blob.size,
              preview: dataUrl,
            })]);
          } catch (error) {
            reportAttachmentError(error);
          }
        };
        reader.onerror = () => reportAttachmentError(reader.error ?? new Error('Clipboard image could not be read'));
        reader.readAsDataURL(blob);
        break;
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const sessionKey = activeSessionKey;
    for (const file of Array.from(e.dataTransfer.files)) {
      const isImage = file.type.startsWith('image/');
      const filePath = (file as any).path || '';  // Electron adds .path to File objects

      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (typeof reader.result !== 'string') throw new Error(`${file.name} could not be read`);
          const dataUrl = reader.result;
          const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
          updateSessionFiles(sessionKey, (prev) => [...prev, createPreparedAttachment({
            fileName: file.name,
            base64,
            mimeType: file.type || undefined,
            size: file.size,
            preview: isImage ? dataUrl : undefined,
            sourcePath: filePath || undefined,
          })]);
        } catch (error) {
          reportAttachmentError(error);
        }
      };
      reader.onerror = () => reportAttachmentError(reader.error ?? new Error(`${file.name} could not be read`));
      reader.readAsDataURL(file);
    }
  };

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

  return (
    <div className="shrink-0 border-t border-[rgb(var(--aegis-overlay)/0.04)] bg-[var(--aegis-bg-frosted-60)] backdrop-blur-xl">
      {/* File Previews */}
      {files.length > 0 && (
        <div className="flex gap-2 px-4 pt-3 overflow-x-auto scrollbar-hidden">
          {files.map((file, i) => (
            <div key={i} className="relative shrink-0 w-[72px] h-[72px] rounded-xl border border-aegis-border/40 overflow-hidden bg-aegis-surface group">
              {file.isImage && file.preview ? (
                <>
                  <img src={file.preview} alt={file.fileName} className="w-full h-full object-cover" />
                  {/* Center eye icon — hover to preview */}
                  <button
                    onClick={() => setLightbox(file.preview || null)}
                    className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all duration-200 z-[5]"
                  >
                    <Eye size={16} className="text-white opacity-0 group-hover:opacity-90 transition-opacity drop-shadow-lg" />
                  </button>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-1">
                  <span className="text-xl">{getFileIcon(file.mimeType)}</span>
                  <span className="text-[8px] text-aegis-text-dim truncate w-full text-center mt-0.5">{file.fileName}</span>
                </div>
              )}
              <button onClick={() => removeFile(i)}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-aegis-danger/85 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-aegis-danger">
                <Trash2 size={9} className="text-white" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-aegis-bg-solid/80 text-[7px] text-center text-aegis-text py-0.5">
                  {formatBytes(file.size)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Queue Strip — messages waiting for the AI to finish its current reply */}
      {queue.length > 0 && (() => {
        const COLLAPSE_AT = 2;
        const visible = queueExpanded ? queue : queue.slice(0, COLLAPSE_AT);
        const hidden = queue.length - visible.length;
        return (
        <div className="px-4 pt-3" dir={dir}>
          <div className="rounded-xl ring-1 ring-aegis-warning/15 bg-aegis-warning/[0.06] overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2">
              <Clock size={13} className="text-aegis-warning shrink-0" />
              <span className="text-[12px] font-medium text-aegis-warning flex-1">
                {queue.length} {t('chat.queueTitle')}
                {waitSeconds !== null && <span className="ml-2 text-[11px] font-normal text-aegis-text-muted">{t('chat.queueWait', { s: waitSeconds })}</span>}
              </span>
              {confirmingClear ? (
                <>
                  <span className="text-[11px] text-aegis-text-muted mr-0.5">{t('chat.queueClearConfirm')}</span>
                  <button onClick={() => { clearQueue(activeSessionKey); setConfirmingClear(false); setQueueExpanded(false); }}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-aegis-danger hover:bg-aegis-danger/10 transition-colors"
                    title={t('chat.queueClear')}>
                    <Check size={13} />
                  </button>
                  <button onClick={() => setConfirmingClear(false)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors">
                    <X size={13} />
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setConfirmingClear(true)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-aegis-text-muted hover:text-aegis-danger hover:bg-aegis-danger/10 transition-colors"
                    title={t('chat.queueClear')}>
                    <Trash2 size={13} />
                  </button>
                  {queue.length > COLLAPSE_AT && (
                    <button onClick={() => setQueueExpanded((v) => !v)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
                      title={queueExpanded ? t('common.collapse', 'Collapse') : t('common.expand', 'Expand')}>
                      {queueExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  )}
                </>
              )}
            </div>
            {/* Visible list (always present, shows 2 collapsed or all expanded) */}
            {visible.length > 0 && (
              <div className="max-h-[144px] overflow-y-auto scrollbar-hidden border-t border-aegis-warning/15">
                {visible.map((item, idx) => (
                  <div key={item.id} className="flex items-start gap-2 px-3 py-2 border-b border-aegis-warning/10 last:border-b-0">
                    {editingQueueIdx === idx ? (
                      <div className="flex-1 min-w-0">
                        <textarea
                          autoFocus
                          value={editingQueueText}
                          onChange={(e) => setEditingQueueText(e.target.value)}
                          rows={2}
                          className="w-full bg-[rgb(var(--aegis-overlay)/0.04)] rounded-lg p-2 text-[12px] text-aegis-text outline-none resize-none"
                        />
                        <div className="flex gap-1.5 mt-1.5">
                          <button
                            onClick={() => {
                              const v = editingQueueText.trim();
                              if (v) updateQueuedMessage(activeSessionKey, item.id, v);
                              setEditingQueueIdx(null);
                              setEditingQueueText('');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20 transition-colors">
                            <Check size={11} />
                          </button>
                          <button
                            onClick={() => { setEditingQueueIdx(null); setEditingQueueText(''); }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold text-aegis-text-muted hover:text-aegis-text-secondary transition-colors">
                            <X size={11} />
                          </button>
                        </div>
                      </div>
                    ) : confirmingDeleteIdx === idx ? (
                      <>
                        <span className="text-[11px] text-aegis-text-muted flex-1">{t('chat.queueDeleteConfirm')}</span>
                        <button
                          onClick={() => { removeQueuedMessage(activeSessionKey, item.id); setConfirmingDeleteIdx(null); }}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-aegis-danger hover:bg-aegis-danger/10 transition-colors shrink-0">
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteIdx(null)}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors shrink-0">
                          <X size={13} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[12px] text-aegis-text-secondary flex-1 min-w-0 break-words">
                          <span className="line-clamp-2">{item.text}</span>
                          {item.failed && (
                            <span className="block mt-0.5 text-[10px] text-aegis-danger line-clamp-1">
                              {item.error || t('chat.sendFailed', '发送失败')}
                            </span>
                          )}
                        </span>
                        {item.failed && (
                          <button
                            onClick={() => { void retryQueuedMessage(activeSessionKey, item.id); }}
                            className="w-5 h-5 rounded-md flex items-center justify-center text-aegis-danger hover:bg-aegis-danger/10 transition-colors shrink-0"
                            title={t('chat.retrySend', '重试发送')}
                          >
                            <RefreshCw size={11} />
                          </button>
                        )}
                        <button
                          onClick={() => { setEditingQueueIdx(idx); setEditingQueueText(item.text); }}
                          className="w-5 h-5 rounded-md flex items-center justify-center text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors shrink-0"
                          title={t('chat.queueEdit')}>
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteIdx(idx)}
                          className="w-5 h-5 rounded-md flex items-center justify-center text-aegis-text-muted hover:text-aegis-danger hover:bg-aegis-danger/10 transition-colors shrink-0"
                          title={t('chat.queueDelete')}>
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {hidden > 0 && !queueExpanded && (
                  <div className="flex items-center justify-center py-1.5 text-[11px] text-aegis-text-muted border-t border-aegis-warning/10">
                    <span>{t('chat.queueMore', { n: hidden })}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {voiceWake.enabled && !voiceMode && (
        <div className="mx-3 mt-2 flex min-h-9 items-center gap-2 border-s-2 border-aegis-primary/70 bg-aegis-primary/[0.055] px-3 py-1.5 text-[11px] text-aegis-text-secondary" role="status">
          <Radio size={13} className="shrink-0 animate-pulse text-aegis-primary" />
          <span className="min-w-0 flex-1 truncate font-medium">{dictationStatus}</span>
          <button
            type="button"
            onClick={toggleDictation}
            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/[0.1] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
          >
            {t('input.stopDictation', '停止听写')}
          </button>
        </div>
      )}
      {voiceWake.error && !voiceMode && (
        <div className="mx-3 mt-2 flex min-h-9 items-center gap-2 border-s-2 border-aegis-danger/70 bg-aegis-danger/[0.055] px-3 py-1.5 text-[11px] text-aegis-text-secondary" role="alert">
          <Mic size={13} className="shrink-0 text-aegis-danger" />
          <span className="min-w-0 flex-1 truncate" title={voiceWake.error}>{t('input.voiceInputFailed', '语音输入不可用')}：{voiceWake.error}</span>
          <button
            type="button"
            onClick={toggleDictation}
            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/[0.1] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
          >
            {t('input.retryVoiceInput', '重试')}
          </button>
          <button
            type="button"
            onClick={() => { void voiceWake.stop(); }}
            className="grid size-6 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
            title={t('input.dismissVoiceInputError', '关闭')}
            aria-label={t('input.dismissVoiceInputError', '关闭')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input Area */}
      {voiceMode ? (
        <div className="flex items-end gap-2 p-3" dir={dir}>
          <div className={clsx(
            'relative flex min-h-[52px] flex-1 items-center rounded-2xl border border-[rgb(var(--aegis-overlay)/0.06)] bg-aegis-surface px-3 py-2',
            'transition-all duration-200 focus-within:border-aegis-primary/30',
            'focus-within:shadow-[0_0_0_3px_rgb(var(--aegis-primary)/0.06),0_0_16px_rgb(var(--aegis-primary)/0.08)]',
          )}>
            <Suspense
              fallback={
                <div className="flex w-full items-center gap-3" dir={dir}>
                  <div className="h-10 flex-1 animate-pulse rounded bg-[rgb(var(--aegis-overlay)/0.04)]" />
                  <span className="min-w-[40px] shrink-0 text-center font-mono text-[13px] text-aegis-text-muted" dir="ltr">0:00</span>
                  <button
                    type="button"
                    onClick={() => setVoiceMode(false)}
                    className="rounded-lg p-2 text-aegis-danger transition-colors hover:bg-aegis-danger/20"
                    title={t('voice.cancel')}
                  >
                    <X size={18} />
                  </button>
                </div>
              }
            >
              <VoiceRecorder
                onSendVoice={handleVoiceSend}
                onCancel={() => setVoiceMode(false)}
                disabled={!connected || isHistoryWarmupGate}
              />
            </Suspense>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-2 p-3" dir={dir}>
          {/* Input Wrapper (matches mockup) */}
          <div className={clsx(
            'relative flex items-center gap-2 px-3 py-2 rounded-2xl flex-1',
            'bg-aegis-surface border border-[rgb(var(--aegis-overlay)/0.06)]',
            'transition-all duration-200',
            'focus-within:border-aegis-primary/30',
            'focus-within:shadow-[0_0_0_3px_rgb(var(--aegis-primary)/0.06),0_0_16px_rgb(var(--aegis-primary)/0.08)]',
            !connected && 'opacity-40'
          )} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
            <div ref={addMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setComposerMenu((current) => current === 'add' ? null : 'add')}
                disabled={!connected || isHistoryWarmupGate}
                className={clsx(
                  'grid size-[34px] place-items-center rounded-lg transition-colors',
                  composerMenu === 'add'
                    ? 'bg-aegis-primary/12 text-aegis-primary'
                    : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-30',
                )}
                title={t('input.addContent', '添加内容')}
                aria-label={t('input.addContent', '添加内容')}
                aria-haspopup="menu"
                aria-expanded={composerMenu === 'add'}
              >
                <Plus size={17} />
              </button>
              {composerMenu === 'add' && (
                <div
                  role="menu"
                  aria-label={t('input.addContent', '添加内容')}
                  className={clsx(
                    'absolute bottom-full z-50 mb-2 w-40 overflow-hidden border border-aegis-menu-border bg-aegis-menu-bg p-1 shadow-[var(--aegis-menu-shadow)]',
                    dir === 'rtl' ? 'right-0' : 'left-0',
                  )}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setComposerMenu(null); void handleFileSelect(); }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                  >
                    <Paperclip size={14} className="shrink-0 text-aegis-primary" />
                    {t('input.attachFile')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setComposerMenu(null); setScreenshotOpen(true); }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                  >
                    <Camera size={14} className="shrink-0 text-aegis-primary" />
                    {t('input.screenshot')}
                  </button>
                </div>
              )}
            </div>

            {/* @ skills and workspace files */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  const el = textareaRef.current;
                  if (!el) return;
                  // Insert '@' then open picker
                  if (text.trim()) {
                    setText((prev) => prev + ' @');
                  } else {
                    setText('@');
                  }
                  setAtPicker({ open: true, query: '', idx: 0 });
                  requestAnimationFrame(() => {
                    el.focus();
                    const pos = el.value.length;
                    el.setSelectionRange(pos, pos);
                  });
                }}
                disabled={!connected || allSkills.length === 0}
                className={clsx(
                  'w-[34px] h-[34px] rounded-lg flex items-center justify-center flex-shrink-0',
                  'bg-[rgb(var(--aegis-overlay)/0.03)] border-none',
                  'text-aegis-text-muted hover:text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.07)]',
                  'transition-colors disabled:opacity-30',
                )}
                title={t('input.skills', '技能')}
              >
                <AtSign size={16} />
              </button>
            </div>

            {/* @ Skills picker */}
            {atPicker.open && (
              <div className="absolute bottom-full left-16 z-50 mb-2 w-[320px] overflow-hidden rounded-xl bg-aegis-menu-bg border border-aegis-menu-border" style={{ boxShadow: 'var(--aegis-menu-shadow)' }}>
                {/* Search input */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--aegis-overlay)/0.06)]">
                  <span className="text-[12px] font-mono text-aegis-text-secondary shrink-0">@</span>
                  <input
                    autoFocus
                    value={atPicker.query}
                    onChange={(e) => setAtPicker((s) => ({ ...s, query: e.target.value, idx: 0 }))}
                    placeholder="搜索技能或文件…"
                    className="flex-1 bg-transparent text-[12px] text-aegis-text placeholder:text-aegis-text-dim outline-none font-mono"
                  />
                  {atPicker.query && (
                    <button onClick={() => setAtPicker((s) => ({ ...s, query: '', idx: 0 }))} className="p-0.5 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim">
                      <X size={11} />
                    </button>
                  )}
                  <span className="text-[10px] text-aegis-text-dim shrink-0">
                    {allSkills.length + workspaceFiles.length} 项
                  </span>
                </div>
                {/* Skill + file list or empty state */}
                <div className="max-h-[240px] overflow-y-auto scrollbar-hidden py-0.5">
                  {matchedAtItems.length > 0 ? matchedAtItems.map((item, i) => {
                    const isSkill = item.kind === 'skill';
                    const label = isSkill ? item.name : item.name;
                    const sub = isSkill ? item.description : item.path;
                    const Icon = isSkill ? Sparkles : File;
                    return (
                      <button
                        key={`${item.kind}:${isSkill ? item.name : item.path}`}
                        onClick={() => pickSkill({ name: label })}
                        onMouseEnter={() => setAtPicker((p) => ({ ...p, idx: i }))}
                        className={clsx(
                          'w-full flex items-center gap-3 px-3 py-2 text-start transition-colors',
                          i === atPicker.idx
                            ? 'bg-[rgb(var(--aegis-primary)/0.08)] border-l-[3px] border-l-aegis-primary pl-[9px]'
                            : 'border-l-[3px] border-l-transparent pl-[9px] hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                        )}
                      >
                        <Icon size={14} className={clsx('shrink-0', i === atPicker.idx ? 'text-aegis-primary' : 'text-aegis-text-dim')} />
                        <div className="flex-1 min-w-0">
                          <span className={clsx('text-[12px] font-mono', i === atPicker.idx ? 'text-aegis-primary' : 'text-aegis-text-secondary')}>
                            @{label}
                          </span>
                          {sub && (
                            <span className="block text-[10px] text-aegis-text-dim truncate">{sub}</span>
                          )}
                        </div>
                      </button>
                    );
                  }) : (allSkills.length === 0 && workspaceFiles.length === 0) ? (
                    <div className="px-3 py-4 text-center text-[11px] text-aegis-text-dim">
                      暂无可用的技能或文件。请检查 Gateway 连接。
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-center text-[11px] text-aegis-text-dim">
                      无匹配项
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 px-3 py-1.5 border-t border-[rgb(var(--aegis-overlay)/0.06)] text-[10px] text-aegis-text-dim/50">
                  <span>↑↓ 导航</span>
                  <span>↵ 选择</span>
                  <span>ESC 关闭</span>
                </div>
              </div>
            )}

            {/* / Slash command picker */}
            {slashPicker.open && matchedSlash.length > 0 && (
              <div className="absolute bottom-full left-16 z-50 mb-2 w-[360px] overflow-hidden rounded-xl bg-aegis-menu-bg border border-aegis-menu-border" style={{ boxShadow: 'var(--aegis-menu-shadow)' }}>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--aegis-overlay)/0.06)]">
                  <span className="text-[12px] font-mono text-aegis-text-secondary">/</span>
                  <span className="text-[12px] text-aegis-text font-mono">{slashPicker.query || '搜索命令…'}</span>
                  <span className="text-[10px] text-aegis-text-dim ml-auto">{matchedSlash.length} 项</span>
                </div>
                <div className="max-h-[280px] overflow-y-auto scrollbar-hidden py-1">
                  {groupedSlash.order.map((cat, gi) => {
                    const meta = CATEGORY_META[cat as SlashCategory];
                    const items = groupedSlash.groups[cat];
                    return (
                      <div key={cat}>
                        {groupedSlash.order.length > 1 && meta && (
                          <div className={clsx('flex items-center gap-2 px-3 py-1.5', gi > 0 && 'mt-1 border-t border-[rgb(var(--aegis-overlay)/0.04)] pt-2')}>
                            <span className="text-aegis-text-dim">{cmdIcon(meta.icon, 11)}</span>
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-aegis-text-dim">{meta.label}</span>
                          </div>
                        )}
                        {items.map((cmd) => {
                          const globalIdx = matchedSlash.indexOf(cmd);
                          const isActive = globalIdx === slashPicker.idx;
                          return (
                            <button
                              key={cmd.cmd}
                              onClick={() => pickSlash(cmd)}
                              onMouseEnter={() => setSlashPicker((s) => ({ ...s, idx: globalIdx }))}
                              className={clsx(
                                'w-full flex items-center gap-3 px-3 py-2 text-start transition-colors',
                                isActive
                                  ? 'bg-[rgb(var(--aegis-primary)/0.08)] border-l-[3px] border-l-aegis-primary pl-[9px]'
                                  : 'border-l-[3px] border-l-transparent pl-[9px] hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                              )}
                            >
                              <span className={clsx('shrink-0', isActive ? 'text-aegis-primary' : 'text-aegis-text-dim')}>
                                {cmdIcon(cmd.icon, 14)}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={clsx('text-[12px] font-mono', isActive ? 'text-aegis-primary' : 'text-aegis-text-secondary')}>
                                    {cmd.label}
                                  </span>
                                  {cmd.local && (
                                    <span className="text-[8px] uppercase font-bold text-aegis-accent px-1 py-px rounded bg-aegis-accent/10 shrink-0">本地</span>
                                  )}
                                  {cmd.argHint && (
                                    <span className="text-[10px] text-aegis-text-dim font-mono hidden sm:inline truncate">{cmd.argHint}</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-aegis-text-dim truncate mt-0.5">{cmd.description}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 px-3 py-1.5 border-t border-[rgb(var(--aegis-overlay)/0.06)] text-[10px] text-aegis-text-dim/50">
                  <span>↑↓ 导航</span>
                  <span>↵ 选择</span>
                  <span>ESC 关闭</span>
                </div>
              </div>
            )}

            {/* Argument completion picker (second-level: /model <arg>) */}
            {argPicker.open && argCompletions.length > 0 && (
              <div className="absolute bottom-full left-16 z-50 mb-2 w-[280px] overflow-hidden rounded-xl bg-aegis-menu-bg border border-aegis-menu-border" style={{ boxShadow: 'var(--aegis-menu-shadow)' }}>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--aegis-overlay)/0.06)]">
                  <span className="text-[11px] font-mono text-aegis-text-secondary">{argPicker.cmd}</span>
                  <span className="text-[12px] text-aegis-text font-mono">{argPicker.query || '选择…'}</span>
                  <span className="text-[10px] text-aegis-text-dim ml-auto">{argCompletions.length} 项</span>
                </div>
                <div className="max-h-[200px] overflow-y-auto scrollbar-hidden py-0.5">
                  {argCompletions.map((item, i) => (
                    <button
                      key={item.value}
                      onClick={() => {
                        const el = textareaRef.current;
                        const before = text.slice(0, el?.selectionStart ?? 0);
                        const after = text.slice(el?.selectionStart ?? 0);
                        const cmdIdx = before.lastIndexOf(argPicker.cmd);
                        const newText = cmdIdx >= 0 ? before.slice(0, cmdIdx) + `${argPicker.cmd} ${item.value} ` + after : before;
                        setText(newText);
                        setArgPicker({ open: false, cmd: '', query: '', idx: 0 });
                        el?.focus();
                      }}
                      onMouseEnter={() => setArgPicker((s) => ({ ...s, idx: i }))}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2 text-start transition-colors',
                        i === argPicker.idx
                          ? 'bg-[rgb(var(--aegis-primary)/0.08)] border-l-[3px] border-l-aegis-primary pl-[9px]'
                          : 'border-l-[3px] border-l-transparent pl-[9px] hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                      )}
                    >
                      <Cpu size={14} className={clsx('shrink-0', i === argPicker.idx ? 'text-aegis-primary' : 'text-aegis-text-dim')} />
                      <div className="flex-1 min-w-0">
                        <span className={clsx('text-[12px] font-mono block truncate', i === argPicker.idx ? 'text-aegis-primary' : 'text-aegis-text-secondary')}>
                          {item.label}
                        </span>
                        {item.label !== item.value && (
                          <span className="text-[10px] text-aegis-text-dim font-mono truncate block">{item.value}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Text Input */}
            <textarea ref={textareaRef} data-input="message" rows={1} value={text} onChange={(e) => {
              const v = e.target.value;
              setText(v);
              if (historyIdx >= 0) setHistoryIdx(-1);
              if (isComposingRef.current) return;
              const el = textareaRef.current;
              const cursorPos = el?.selectionStart ?? 0;
              const textBeforeCursor = v.slice(0, cursorPos);
              const lines = textBeforeCursor.split('\n');
              const currentLine = lines[lines.length - 1] ?? '';
              const parts = currentLine.split(/\s+/);

              // Phase 1: /<cmd> with no space → show command picker
              if (currentLine.startsWith('/') && !currentLine.includes(' ')) {
                setSlashPicker({ open: true, query: currentLine.slice(1), idx: 0 });
                if (atPicker.open) setAtPicker({ open: false, query: '', idx: 0 });
                if (argPicker.open) setArgPicker({ open: false, cmd: '', query: '', idx: 0 });
              }
              // Phase 2: /model <arg> → show argument completions
              else if (currentLine.startsWith('/') && parts.length >= 2 && parts[0]) {
                const cmdName = parts[0];
                const argQuery = parts.slice(1).join(' ');
                if (slashPicker.open) setSlashPicker({ open: false, query: '', idx: 0 });
                if (atPicker.open) setAtPicker({ open: false, query: '', idx: 0 });
                // Show arg picker for commands that have completions (static or dynamic)
                const matchedCmd = slashCommands.find((c) => c.cmd === cmdName);
                const hasCompletions = (cmdName === '/model' && availableModels.length > 0)
                  || (matchedCmd?.argChoices && matchedCmd.argChoices.length > 0);
                if (hasCompletions) {
                  setArgPicker({ open: true, cmd: cmdName, query: argQuery, idx: 0 });
                } else if (argPicker.open) {
                  setArgPicker({ open: false, cmd: '', query: '', idx: 0 });
                }
              }
              // Phase 3: @ → skills
              else if (currentLine.startsWith('@') && !currentLine.includes(' ')) {
                setAtPicker({ open: true, query: currentLine.slice(1), idx: 0 });
                if (slashPicker.open) setSlashPicker({ open: false, query: '', idx: 0 });
                if (argPicker.open) setArgPicker({ open: false, cmd: '', query: '', idx: 0 });
              } else {
                if (slashPicker.open) setSlashPicker({ open: false, query: '', idx: 0 });
                if (atPicker.open) setAtPicker({ open: false, query: '', idx: 0 });
                if (argPicker.open) setArgPicker({ open: false, cmd: '', query: '', idx: 0 });
              }
            }}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { setTimeout(() => { isComposingRef.current = false; }, 0); }}
              onKeyDown={(e) => {
                // ── Input history navigation (when input empty, no picker open) ──
                const noPickerOpen = !argPicker.open && !slashPicker.open && !atPicker.open;
                const inputEmpty = !text.trim();
                if (noPickerOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                  if (inputEmpty && userMessageHistory.length > 0) {
                    e.preventDefault();
                    if (e.key === 'ArrowUp') {
                      const next = Math.min(historyIdx + 1, userMessageHistory.length - 1);
                      setHistoryIdx(next);
                      setText(userMessageHistory[next]);
                    } else {
                      const next = historyIdx - 1;
                      if (next < 0) { setHistoryIdx(-1); setText(''); }
                      else { setHistoryIdx(next); setText(userMessageHistory[next]); }
                    }
                    return;
                  }
                  // Allow normal ArrowUp/Down when input has text (cursor movement)
                }

                // Arg picker navigation (second-level: /model <arg>)
                if (argPicker.open && argCompletions.length > 0) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setArgPicker((s) => ({ ...s, idx: (s.idx + 1) % argCompletions.length })); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setArgPicker((s) => ({ ...s, idx: (s.idx - 1 + argCompletions.length) % argCompletions.length })); return; }
                  if (e.key === 'Tab' || e.key === 'Enter') {
                    e.preventDefault();
                    const picked = argCompletions[argPicker.idx];
                    if (picked) {
                      // Replace the arg portion with the selected value
                      const el = textareaRef.current;
                      const before = text.slice(0, el?.selectionStart ?? 0);
                      const after = text.slice(el?.selectionStart ?? 0);
                      const cmdIdx = before.lastIndexOf(argPicker.cmd);
                      if (cmdIdx >= 0) {
                        const newText = before.slice(0, cmdIdx) + `${argPicker.cmd} ${picked.value} ` + after;
                        setText(newText);
                      }
                      setArgPicker({ open: false, cmd: '', query: '', idx: 0 });
                    }
                    return;
                  }
                  if (e.key === 'Escape') { e.preventDefault(); setArgPicker({ open: false, cmd: '', query: '', idx: 0 }); return; }
                }
                // Slash command picker navigation
                if (slashPicker.open && matchedSlash.length > 0) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSlashPicker((s) => ({ ...s, idx: (s.idx + 1) % matchedSlash.length })); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSlashPicker((s) => ({ ...s, idx: (s.idx - 1 + matchedSlash.length) % matchedSlash.length })); return; }
                  if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pickSlash(matchedSlash[slashPicker.idx]); return; }
                  if (e.key === 'Escape') { e.preventDefault(); setSlashPicker({ open: false, query: '', idx: 0 }); return; }
                }
                // @ Skills picker navigation
                if (atPicker.open && matchedAtItems.length > 0) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setAtPicker((s) => ({ ...s, idx: (s.idx + 1) % matchedAtItems.length })); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setAtPicker((s) => ({ ...s, idx: (s.idx - 1 + matchedAtItems.length) % matchedAtItems.length })); return; }
                  if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pickSkill(matchedAtItems[atPicker.idx]); return; }
                  if (e.key === 'Escape') { e.preventDefault(); setAtPicker({ open: false, query: '', idx: 0 }); return; }
                }
                if (e.key !== 'Enter' || e.shiftKey) return;
                // Block Enter entirely while IME is composing (e.g. confirming "IBM" in Chinese mode).
                // nativeEvent.isComposing is the reliable W3C flag; isComposingRef covers browsers
                // where the flag fires slightly late.
                const nativeIsComposing = (e.nativeEvent as { isComposing?: boolean }).isComposing;
                if (isComposingRef.current || nativeIsComposing) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                handleSend();
              }}
              onPaste={handlePaste}
              placeholder={
                isHistoryWarmupGate
                  ? t('input.placeholderHistoryLoading')
                  : connected
                    ? (t('input.placeholderSlash', '输入消息，或输入 / 命令、@ 技能…') as string)
                    : t('input.placeholderDisconnected')
              }
              className={clsx(
                'flex-1 resize-none bg-transparent border-none text-[14px]',
                'text-aegis-text placeholder:text-aegis-text-muted',
                'focus:outline-none focus-visible:shadow-none py-1.5 px-1 leading-[1.2]',
                'max-h-[180px] scrollbar-hidden'
              )}
              dir={dir} />

            <div className="flex shrink-0 items-center gap-0.5">
              <div ref={voiceMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (voiceWake.enabled) {
                      toggleDictation();
                      return;
                    }
                    setComposerMenu((current) => current === 'voice' ? null : 'voice');
                  }}
                  disabled={!connected || isHistoryWarmupGate}
                  className={clsx(
                    'relative grid size-[34px] place-items-center rounded-lg transition-colors',
                    voiceWake.enabled
                      ? 'bg-aegis-primary/12 text-aegis-primary hover:bg-aegis-primary/18'
                      : composerMenu === 'voice'
                        ? 'bg-aegis-primary/12 text-aegis-primary'
                        : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-30',
                  )}
                  title={voiceWake.enabled ? t('input.stopDictation', '停止听写') : t('input.voiceInput', '语音输入')}
                  aria-label={voiceWake.enabled ? t('input.stopDictation', '停止听写') : t('input.voiceInput', '语音输入')}
                  aria-haspopup={voiceWake.enabled ? undefined : 'menu'}
                  aria-expanded={composerMenu === 'voice'}
                >
                  <Mic size={16} />
                  {voiceWake.enabled && <span className="absolute end-1 top-1 size-1.5 rounded-full bg-aegis-primary ring-2 ring-aegis-surface" />}
                </button>
                {composerMenu === 'voice' && (
                  <div
                    role="menu"
                    aria-label={t('input.voiceInputMenu', '语音输入选项')}
                    className={clsx(
                      'absolute bottom-full z-50 mb-2 w-40 overflow-hidden border border-aegis-menu-border bg-aegis-menu-bg p-1 shadow-[var(--aegis-menu-shadow)]',
                      dir === 'rtl' ? 'right-0' : 'left-0',
                    )}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={startVoiceRecording}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                    >
                      <Mic size={14} className="shrink-0 text-aegis-primary" />
                      {t('input.recordVoice', '录制语音')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={toggleDictation}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                    >
                      <Radio size={14} className="shrink-0 text-aegis-primary" />
                      {t('input.continuousDictation', '连续听写')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Send button — always available. Becomes "Queue" while the AI is
                running: handleSend routes the text into messageQueue automatically
                (see typingBySession branch). Badge shows the queued count. */}
            <button onClick={handleSend}
              disabled={(!text.trim() && files.length === 0) || !connected || isHistoryWarmupGate}
              className={clsx(
                'w-[34px] h-[34px] rounded-lg flex items-center justify-center flex-shrink-0 transition-all relative',
                text.trim() || files.length > 0
                  ? 'bg-aegis-primary text-white shadow-[0_2px_8px_rgb(var(--aegis-primary)/0.3)] hover:shadow-[0_4px_16px_rgb(var(--aegis-primary)/0.4)] hover:-translate-y-px'
                  : 'text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
              )}
              title={isHistoryWarmupGate
                ? t('input.historyLoading')
                : (voiceOutputActive && !isTyping && !isSending
                  ? t('input.voiceStop', '停止语音')
                  : (isTyping ? t('input.queue', 'Queue') : t('input.send')))}>
              <Send size={16} className={dir === 'rtl' ? 'rotate-180' : ''} />
              {isTyping && pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-aegis-primary text-white text-[9px] font-bold leading-none">
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              )}
            </button>

            {/* Stop button — while the AI or voice output is active */}
            {(isTyping || isSending || voiceOutputActive) && (
              <button onClick={async () => {
                try {
                  voiceRuntime.interruptGlobally(activeSessionKey);
                  if (isTyping || isSending) {
                    await gateway.abortChat(activeSessionKey);
                    clearQueue(activeSessionKey);
                    setIsTyping(false, activeSessionKey);
                    setIsSending(false, activeSessionKey);
                  }
                } catch (err) {
                  debugError('app', '[Abort] Error:', err);
                }
              }}
                className="w-[34px] h-[34px] rounded-lg flex items-center justify-center flex-shrink-0 bg-aegis-danger/80 hover:bg-aegis-danger text-aegis-text transition-all">
                <Square size={12} fill="currentColor" />
              </button>
            )}
          </div>
        </div>
      )}

      {screenshotOpen && (
        <Suspense fallback={null}>
          <ScreenshotPicker
            open={screenshotOpen}
            onClose={() => setScreenshotOpen(false)}
            onCapture={handleScreenshotCapture}
          />
        </Suspense>
      )}

      {/* Image lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md" onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors z-10">
            <X size={20} className="text-white" />
          </button>
          <img src={lightbox} alt="Preview" className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
