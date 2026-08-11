import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InlineButtonBar } from './InlineButtonBar';
import { QuickReplyBar } from './QuickReplyBar';

test('快捷回复提供可访问的关闭操作和减少动态效果安全的入场反馈', () => {
  const html = renderToStaticMarkup(
    <QuickReplyBar
      buttons={[{ text: '继续', value: '继续' }]}
      onSend={() => undefined}
      onDismiss={() => undefined}
    />,
  );

  assert.match(html, /aria-label="[^"]+"/);
  assert.match(html, /motion-safe:animate-fade-in/);
  assert.match(html, /focus-visible:ring-2/);
  assert.match(html, /aria-pressed="false"/);
  assert.doesNotMatch(html, /<style>/);
  assert.doesNotMatch(html, /shadow-lg/);
});

test('Gateway 内联按钮保留原有按钮文本，并提供一致的键盘焦点反馈', () => {
  const html = renderToStaticMarkup(
    <InlineButtonBar
      buttons={[[{ text: '确认', callback_data: 'confirm', style: 'primary' }]]}
      onCallback={() => undefined}
    />,
  );

  assert.match(html, />确认</);
  assert.match(html, /motion-safe:animate-fade-in/);
  assert.match(html, /focus-visible:ring-2/);
  assert.match(html, /aria-pressed="false"/);
  assert.doesNotMatch(html, /<style>/);
});
