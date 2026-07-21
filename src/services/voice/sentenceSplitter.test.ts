import test from 'node:test';
import assert from 'node:assert/strict';
import { SentenceSplitter, sanitizeSpeechText } from './sentenceSplitter';

test('SentenceSplitter emits Chinese sentences across deltas', () => {
  const splitter = new SentenceSplitter();
  assert.deepEqual(splitter.feed('你好，JunQi'), []);
  assert.deepEqual(splitter.feed('。这是第二句'), ['你好，JunQi。']);
  assert.equal(splitter.flush(), '这是第二句');
});

test('SentenceSplitter handles English punctuation only at a boundary', () => {
  const splitter = new SentenceSplitter();
  assert.deepEqual(splitter.feed('Use v1.2.3 carefully. Next'), ['Use v1.2.3 carefully.']);
  assert.equal(splitter.flush(), 'Next');
});

test('SentenceSplitter defers a chunk-terminal period', () => {
  const splitter = new SentenceSplitter();
  assert.deepEqual(splitter.feed('Version v1.'), []);
  assert.deepEqual(splitter.feed('2 is ready. Next'), ['Version v1.2 is ready.']);
  assert.equal(splitter.flush(), 'Next');
});

test('sanitizeSpeechText removes code and control directives', () => {
  assert.equal(
    sanitizeSpeechText('结论。```ts\nconst x = 1;\n``` [[button:继续]] MEDIA:/tmp/a.mp3'),
    '结论。',
  );
});

test('sanitizeSpeechText withholds unfinished control blocks', () => {
  assert.equal(sanitizeSpeechText('结论。```ts\nconsole.log("not speech.");'), '结论。');
  assert.equal(sanitizeSpeechText('说明。<openclaw_artifact title="x">隐藏。'), '说明。');
  assert.equal(sanitizeSpeechText('按钮。[[button:继续'), '按钮。');
});
