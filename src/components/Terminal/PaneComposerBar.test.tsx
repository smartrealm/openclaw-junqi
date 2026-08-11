import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaneComposerBar } from './PaneComposerBar';

test('收起的终端输入栏保留过渡容器且不接收键盘焦点', () => {
  const markup = renderToStaticMarkup(
    <PaneComposerBar
      isOpen={false}
      draft=""
      onDraftChange={() => undefined}
      onSend={() => undefined}
      onClose={() => undefined}
    />,
  );

  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /max-height:0/);
  assert.match(markup, /<textarea[^>]*tabindex="-1"/);
  assert.match(markup, /<button[^>]*tabindex="-1"/);
  assert.doesNotMatch(markup, /display:none/);
});
