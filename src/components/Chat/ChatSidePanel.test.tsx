import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatSidePanel } from './ChatSidePanel';

test('chat side panel exposes an accessible header action before the close control', () => {
  const markup = renderToStaticMarkup(
    <ChatSidePanel
      title="原始会话记录"
      titleId="source-record-title"
      closeLabel="关闭"
      onClose={() => undefined}
      headerActions={<button type="button" aria-label="复制原始记录">复制</button>}
    >
      <div>记录内容</div>
    </ChatSidePanel>,
  );

  assert.match(markup, /aria-labelledby="source-record-title"/);
  assert.match(markup, /aria-label="复制原始记录"/);
  assert.ok(markup.indexOf('aria-label="复制原始记录"') < markup.indexOf('aria-label="关闭"'));
});
