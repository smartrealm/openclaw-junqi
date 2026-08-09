import { invoke } from '@tauri-apps/api/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import type { SlashCommand } from '@/data/slashCommands';
import { gateway } from '@/services/gateway';
import { useOpenClawCommands } from '@/hooks/useOpenClawCommands';
import { debugError } from '@/utils/debugLog';
import { agentIdFromSessionKey } from '@/utils/sessionPresentation';
import {
  buildArgumentCompletions,
  buildMentionItems,
  buildUserMessageHistory,
  filterSlashCommands,
  groupSlashCommands,
  parseGatewaySkills,
  replaceCommandArgumentCompletion,
  toComposerSlashCommands,
  type ArgumentCompletion,
  type ComposerMessage,
  type GatewaySkill,
  type MentionItem,
} from '@/components/Chat/message-input/composerSuggestionDomain';

export interface PickerState {
  open: boolean;
  query: string;
  idx: number;
}

export interface ArgumentPickerState extends PickerState {
  cmd: string;
  argumentIndex: number;
}

interface UseComposerSuggestionsOptions {
  activeSessionKey: string;
  connected: boolean;
  messages: ComposerMessage[];
  text: string;
  setText: (next: SetStateAction<string>) => void;
}

const CLOSED_PICKER: PickerState = { open: false, query: '', idx: 0 };
const CLOSED_ARGUMENT_PICKER: ArgumentPickerState = { ...CLOSED_PICKER, cmd: '', argumentIndex: 0 };

export function useComposerSuggestions({
  activeSessionKey,
  connected,
  messages,
  text,
  setText,
}: UseComposerSuggestionsOptions) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [slashPicker, setSlashPicker] = useState<PickerState>(CLOSED_PICKER);
  const [mentionPicker, setMentionPicker] = useState<PickerState>(CLOSED_PICKER);
  const [argumentPicker, setArgumentPicker] = useState<ArgumentPickerState>(CLOSED_ARGUMENT_PICKER);
  const [skills, setSkills] = useState<GatewaySkill[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [workspaceFilesLoaded, setWorkspaceFilesLoaded] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const agentId = agentIdFromSessionKey(activeSessionKey) ?? undefined;
  const {
    commands: runtimeCommands,
    loading: slashCommandsLoading,
    failure: slashCommandsFailure,
  } = useOpenClawCommands(connected, {
    agentId,
    scope: 'text',
    includeArgs: true,
  });
  const slashCommands = useMemo(
    () => toComposerSlashCommands(runtimeCommands),
    [runtimeCommands],
  );
  useEffect(() => {
    if (!connected) return;
    void gateway.getSkills()
      .then((result) => setSkills(parseGatewaySkills(result)))
      .catch((error) => debugError('gateway', '[ComposerSuggestions] Unable to load skills:', error));
  }, [connected]);

  const loadWorkspaceFiles = useCallback(async () => {
    if (workspaceFilesLoaded) return;
    try {
      const workspacePath = await invoke<string>('get_workspace_path');
      const paths = await invoke<string[]>('list_project_files', { projectPath: workspacePath });
      setWorkspaceFiles((paths ?? []).map((path) => ({
        name: path.split('/').pop() ?? path,
        path,
      })));
      setWorkspaceFilesLoaded(true);
    } catch (error) {
      debugError('app', '[ComposerSuggestions] Workspace file completion unavailable:', error);
    }
  }, [workspaceFilesLoaded]);

  useEffect(() => {
    if (mentionPicker.open && !workspaceFilesLoaded) void loadWorkspaceFiles();
  }, [loadWorkspaceFiles, mentionPicker.open, workspaceFilesLoaded]);

  useEffect(() => {
    setHistoryIndex(-1);
  }, [activeSessionKey, messages.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [text]);

  useEffect(() => {
    textareaRef.current?.focus();
    const focus = () => textareaRef.current?.focus();
    window.addEventListener('aegis:focus-composer', focus);
    return () => window.removeEventListener('aegis:focus-composer', focus);
  }, []);

  const matchedSlash = useMemo(
    () => slashPicker.open ? filterSlashCommands(slashPicker.query, slashCommands) : [],
    [slashCommands, slashPicker.open, slashPicker.query],
  );
  const groupedSlash = useMemo(() => groupSlashCommands(matchedSlash), [matchedSlash]);
  const mentionItems = useMemo<MentionItem[]>(
    () => mentionPicker.open ? buildMentionItems(mentionPicker.query, skills, workspaceFiles) : [],
    [mentionPicker.open, mentionPicker.query, skills, workspaceFiles],
  );
  const argumentCompletions = useMemo<ArgumentCompletion[]>(
    () => argumentPicker.open
      ? buildArgumentCompletions(
        argumentPicker.cmd,
        argumentPicker.query,
        slashCommands,
        argumentPicker.argumentIndex,
      )
      : [],
    [argumentPicker, slashCommands],
  );

  useEffect(() => {
    setSlashPicker((state) => ({ ...state, idx: Math.min(state.idx, Math.max(0, matchedSlash.length - 1)) }));
  }, [matchedSlash.length]);
  useEffect(() => {
    setMentionPicker((state) => ({ ...state, idx: Math.min(state.idx, Math.max(0, mentionItems.length - 1)) }));
  }, [mentionItems.length]);
  useEffect(() => {
    setArgumentPicker((state) => ({ ...state, idx: Math.min(state.idx, Math.max(0, argumentCompletions.length - 1)) }));
  }, [argumentCompletions.length]);

  const userMessageHistory = useMemo(() => buildUserMessageHistory(messages), [messages]);
  const pickSlash = useCallback((command: SlashCommand) => {
    setSlashPicker(CLOSED_PICKER);
    setText(`${command.cmd} `);
    textareaRef.current?.focus();
  }, [setText]);

  const closeSlashPicker = useCallback(() => setSlashPicker(CLOSED_PICKER), []);
  const closeMentionPicker = useCallback(() => setMentionPicker(CLOSED_PICKER), []);
  const closeArgumentPicker = useCallback(() => setArgumentPicker(CLOSED_ARGUMENT_PICKER), []);

  const pickMention = useCallback((item: MentionItem) => {
    const textarea = textareaRef.current;
    const inserted = `@${item.name} `;
    const cursor = textarea?.selectionStart ?? 0;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const mentionStart = before.lastIndexOf('@');
    setText(mentionStart >= 0 ? before.slice(0, mentionStart) + inserted + after : inserted + after);
    setMentionPicker(CLOSED_PICKER);
    textarea?.focus();
  }, [setText, text]);

  const pickArgument = useCallback((completion: ArgumentCompletion) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? 0;
    const next = replaceCommandArgumentCompletion({
      text,
      cursor,
      command: argumentPicker.cmd,
      argumentIndex: argumentPicker.argumentIndex,
      value: completion.value,
    });
    if (next !== null) setText(next);
    setArgumentPicker(CLOSED_ARGUMENT_PICKER);
    textarea?.focus();
  }, [argumentPicker.cmd, setText, text]);

  const openMentions = useCallback(() => {
    setText((current) => current.trim() ? `${current} @` : '@');
    setMentionPicker({ open: true, query: '', idx: 0 });
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      const position = textarea?.value.length ?? 0;
      textarea?.setSelectionRange(position, position);
    });
  }, [setText]);

  const onChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setText(value);
    if (historyIndex >= 0) setHistoryIndex(-1);
    if (composingRef.current) return;
    const cursor = event.target.selectionStart ?? 0;
    const currentLine = value.slice(0, cursor).split('\n').at(-1) ?? '';
    const parts = currentLine.split(/\s+/);

    if (currentLine.startsWith('/') && !currentLine.includes(' ')) {
      setSlashPicker({ open: true, query: currentLine.slice(1), idx: 0 });
      setMentionPicker(CLOSED_PICKER);
      setArgumentPicker(CLOSED_ARGUMENT_PICKER);
      return;
    }
    if (currentLine.startsWith('/') && parts.length >= 2 && parts[0]) {
      const commandName = parts[0];
      const argumentIndex = Math.max(0, parts.length - 2);
      const argument = slashCommands.find((candidate) => candidate.cmd === commandName)?.args?.[argumentIndex];
      const hasCompletions = argument?.dynamic !== true && Boolean(argument?.choices?.length);
      setSlashPicker(CLOSED_PICKER);
      setMentionPicker(CLOSED_PICKER);
      setArgumentPicker(hasCompletions
        ? { open: true, cmd: commandName, argumentIndex, query: parts.slice(-1)[0] ?? '', idx: 0 }
        : CLOSED_ARGUMENT_PICKER);
      return;
    }
    if (currentLine.startsWith('@') && !currentLine.includes(' ')) {
      setMentionPicker({ open: true, query: currentLine.slice(1), idx: 0 });
      setSlashPicker(CLOSED_PICKER);
      setArgumentPicker(CLOSED_ARGUMENT_PICKER);
      return;
    }
    setSlashPicker(CLOSED_PICKER);
    setMentionPicker(CLOSED_PICKER);
    setArgumentPicker(CLOSED_ARGUMENT_PICKER);
  }, [historyIndex, setText, slashCommands]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>, send: () => void) => {
    const move = <T,>(state: PickerState, setState: (value: SetStateAction<T>) => void, length: number) => {
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setState((current) => ({ ...(current as object), idx: (state.idx + delta + length) % length } as T));
    };
    if (!argumentPicker.open && !slashPicker.open && !mentionPicker.open && !text.trim()
      && userMessageHistory.length > 0 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (event.key === 'ArrowUp') {
        const next = Math.min(historyIndex + 1, userMessageHistory.length - 1);
        setHistoryIndex(next);
        setText(userMessageHistory[next] ?? '');
      } else {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setText(next < 0 ? '' : (userMessageHistory[next] ?? ''));
      }
      return;
    }
    if (argumentPicker.open && argumentCompletions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(argumentPicker, setArgumentPicker, argumentCompletions.length);
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        const completion = argumentCompletions[argumentPicker.idx];
        if (completion) pickArgument(completion);
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); setArgumentPicker(CLOSED_ARGUMENT_PICKER); return; }
    }
    if (slashPicker.open && matchedSlash.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(slashPicker, setSlashPicker, matchedSlash.length);
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        const command = matchedSlash[slashPicker.idx];
        if (command) pickSlash(command);
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); setSlashPicker(CLOSED_PICKER); return; }
    }
    if (mentionPicker.open && mentionItems.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(mentionPicker, setMentionPicker, mentionItems.length);
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        const item = mentionItems[mentionPicker.idx];
        if (item) pickMention(item);
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); setMentionPicker(CLOSED_PICKER); return; }
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (composingRef.current || (event.nativeEvent as { isComposing?: boolean }).isComposing) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    send();
  }, [
    argumentCompletions,
    argumentPicker,
    historyIndex,
    matchedSlash,
    mentionItems,
    mentionPicker,
    pickArgument,
    pickMention,
    pickSlash,
    setText,
    slashPicker,
    text,
    userMessageHistory,
  ]);

  return {
    textareaRef,
    composingRef,
    skills,
    slashCommandsLoading,
    slashCommandsFailure,
    workspaceFiles,
    slashPicker,
    setSlashPicker,
    closeSlashPicker,
    matchedSlash,
    groupedSlash,
    mentionPicker,
    setMentionPicker,
    closeMentionPicker,
    mentionItems,
    argumentPicker,
    setArgumentPicker,
    closeArgumentPicker,
    argumentCompletions,
    pickSlash,
    pickMention,
    pickArgument,
    openMentions,
    onChange,
    onKeyDown,
  };
}
