import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('composer consolidates attachments and voice input into accessible menus', () => {
  const input = source('src/components/Chat/MessageInput.tsx');

  assert.match(input, /const \[composerMenu, setComposerMenu\] = useState<'add' \| 'voice' \| null>/);
  assert.match(input, /input\.addContent/);
  assert.match(input, /input\.voiceInputMenu/);
  assert.match(input, /input\.recordVoice/);
  assert.match(input, /input\.continuousDictation/);
  assert.match(input, /aria-haspopup="menu"/);
  assert.match(input, /if \(composerMenu\) \{\s+e\.preventDefault\(\);\s+setComposerMenu\(null\)/);
  assert.doesNotMatch(input, /\{\s*icon: Radio,/);
});

test('composer keeps dictation observable and recoverable', () => {
  const input = source('src/components/Chat/MessageInput.tsx');
  const wake = source('src/hooks/useVoiceWake.ts');

  assert.match(input, /voiceWake\.enabled && !voiceMode/);
  assert.match(input, /voiceWake\.error && !voiceMode/);
  assert.match(input, /input\.stopDictation/);
  assert.match(input, /input\.retryVoiceInput/);
  assert.match(wake, /setEnabled\(false\);\s+setError\(null\);\s+updatePhase\('idle'\)/);
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
  ];

  for (const language of ['en', 'zh', 'zh-TW', 'ar']) {
    const locale = JSON.parse(source(`src/locales/${language}.json`));
    for (const key of keys) {
      assert.equal(typeof locale.input?.[key], 'string', `${language} is missing input.${key}`);
    }
  }
});
