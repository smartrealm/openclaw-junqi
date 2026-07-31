import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('composer consolidates attachments and voice input into accessible menus', () => {
  const input = source('src/components/Chat/MessageInput.tsx');
  const surface = source('src/components/Chat/message-input/ComposerInputSurface.tsx');
  const menu = source('src/components/Chat/message-input/useComposerMenu.ts');
  const actionMenu = source('src/components/Chat/message-input/ComposerActionMenu.tsx');
  const suggestionMenus = source('src/components/Chat/message-input/ComposerSuggestionMenus.tsx');
  const suggestionPopover = source('src/components/Chat/message-input/ComposerSuggestionPopover.tsx');
  const interruption = source('src/components/Chat/message-input/useComposerInterruption.ts');

  assert.match(input, /useComposerMenu\(activeSessionKey\)/);
  assert.match(input, /<ComposerInputSurface/);
  assert.match(menu, /useState<ComposerMenuId>\(null\)/);
  assert.match(menu, /const setOpen = useCallback/);
  assert.doesNotMatch(menu, /document\.addEventListener\('mousedown'/);
  assert.match(surface, /ComposerActionMenu/);
  assert.doesNotMatch(surface, /absolute bottom-full/);
  assert.match(actionMenu, /DropdownMenuContent/);
  assert.match(actionMenu, /DropdownMenuTrigger asChild/);
  assert.match(actionMenu, /side="top"/);
  assert.match(actionMenu, /collisionPadding=\{12\}/);
  assert.match(surface, /align="start"/);
  assert.match(surface, /align="end"/);
  assert.match(surface, /min-w-0/);
  assert.match(surface, /input\.addContent/);
  assert.match(surface, /input\.voiceInputMenu/);
  assert.match(surface, /input\.recordVoice/);
  assert.match(surface, /input\.continuousDictation/);
  assert.match(surface, /ariaLabel=\{t\('input\.voiceInputMenu'\)\}/);
  assert.match(surface, /ComposerSuggestionMenus controller=\{suggestions\} dir=\{dir\}/);
  assert.doesNotMatch(suggestionMenus, /absolute bottom-full/);
  assert.match(suggestionMenus, /ComposerSuggestionPopover/);
  assert.match(suggestionPopover, /Popover\.Portal/);
  assert.match(suggestionPopover, /dir=\{dir\}/);
  assert.match(suggestionPopover, /side="top"/);
  assert.match(suggestionPopover, /collisionPadding=\{12\}/);
  assert.match(suggestionPopover, /onOpenAutoFocus/);
  assert.match(suggestionPopover, /onCloseAutoFocus/);
  assert.match(interruption, /if \(activeMenu\) \{\s+event\.preventDefault\(\);\s+closeMenu\(\)/);
  assert.doesNotMatch(surface, /\{\s*icon: Radio,/);
  assert.doesNotMatch(input, /lucide-react|gateway\.|useVoiceWake|<textarea/);
});

test('session runtime control has a single stable top context owner beside workspace', () => {
  const input = source('src/components/Chat/message-input/ComposerInputSurface.tsx');
  const runtime = source('src/components/Chat/session-runtime/SessionRuntimeControl.tsx');
  const settings = source('src/components/Chat/session-runtime/useSessionRuntimeSettings.ts');
  const topBar = source('src/components/Chat/SessionContextBar.tsx');

  assert.doesNotMatch(input, /SessionRuntimeControl/);
  assert.match(topBar, /<WorkspacePicker[\s\S]*<SessionRuntimeControl/);
  assert.doesNotMatch(topBar, /ModelDropdown|SessionThinkingPicker/);
  assert.match(runtime, /absolute top-full start-0/);
  assert.doesNotMatch(runtime, /absolute bottom-full/);
  assert.match(runtime, /const modelLabel = modelDisplayName\(activeModel, committed\.modelId\)/);
  assert.match(runtime, /if \(!saving\) setOpen/);
  assert.doesNotMatch(runtime, /switching \? null/);
  assert.match(settings, /activeSessionKey === sessionKey/);
  assert.match(settings, /setSessionThinking\(sessionKey, nextThinking\)/);
  assert.match(settings, /setSessionModel\(null, sessionKey\)/);
  assert.match(runtime, /input\.useDefaultModel/);
});

test('composer keeps dictation observable and recoverable', () => {
  const input = source('src/components/Chat/MessageInput.tsx');
  const status = source('src/components/Chat/message-input/VoiceStatusBanner.tsx');
  const workspace = source('src/components/Chat/message-input/VoiceWorkspace.tsx');
  const voice = source('src/components/Chat/message-input/useComposerVoice.ts');
  const wake = source('src/hooks/useVoiceWake.ts');

  assert.match(input, /<VoiceStatusBanner/);
  assert.match(input, /<VoiceWorkspace/);
  assert.match(workspace, /onConfirmDraft/);
  assert.match(workspace, /voiceWakeUnavailable/);
  assert.match(status, /input\.stopDictation/);
  assert.match(status, /input\.retryVoiceInput/);
  assert.match(voice, /useVoiceWake/);
  assert.match(wake, /setEnabled\(false\);\s+setError\(null\);\s+updatePhase\('idle'\)/);
});

test('queued messages use a collapsed dispatch control instead of a second message timeline', () => {
  const input = source('src/components/Chat/MessageInput.tsx');
  const queue = source('src/components/Chat/message-input/MessageQueuePanel.tsx');

  assert.match(input, /<MessageQueuePanel/);
  assert.match(queue, /onClick=\{\(\) => setExpanded\(\(value\) => !value\)\}/);
  assert.match(queue, /data-message-queue-placement="composer-above"/);
  assert.match(queue, /mx-auto w-full max-w-\[760px\]/);
  assert.match(queue, /queue\[0\]\?\.text/);
  assert.doesNotMatch(queue, /aegis-warning/);
  assert.match(queue, /\{expanded && \(/);
  assert.doesNotMatch(queue, /const COLLAPSE_AT/);
  assert.doesNotMatch(queue, /const visible = queue/);
});

test('composer menu labels are localized in every shipped language', () => {
  const keys = [
    'addContent',
    'voiceInput',
    'voiceInputMenu',
    'recordVoice',
    'continuousDictation',
    'dictationListening',
    'dictationProcessing',
    'stopDictation',
    'voiceInputFailed',
    'retryVoiceInput',
    'dismissVoiceInputError',
    'wakeWordMode',
    'voiceWorkspaceTitle',
    'voiceModeOff',
    'voiceModeDictation',
    'voiceModeWake',
    'voiceWakeUnavailable',
    'voiceGatewayUnavailable',
    'voiceTargetChanged',
    'voiceCaptureFailed',
    'voiceWorkspaceListening',
    'voiceWorkspaceTriggered',
    'voiceWorkspaceTranscribing',
    'voiceWorkspaceDraftReady',
    'voiceWorkspaceUnavailable',
    'voiceWorkspacePreparing',
    'voiceWorkspaceLocalOnly',
    'voiceAudioDraft',
    'voiceConfirmDraft',
    'voiceDiscardDraft',
    'voiceWorkspaceStop',
    'sessionRuntimeTitle',
    'sessionRuntimeProvider',
    'sessionRuntimeModel',
    'useDefaultModel',
    'useDefaultModelHint',
  ];

  for (const language of ['en', 'zh', 'zh-TW']) {
    const locale = JSON.parse(source(`src/locales/${language}.json`));
    for (const key of keys) {
      assert.equal(typeof locale.input?.[key], 'string', `${language} is missing input.${key}`);
    }
  }
});
