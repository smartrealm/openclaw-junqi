import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerPrimaryActionButton } from './ComposerPrimaryActionButton';

test('主操作组件每个状态只渲染一个可访问按钮', () => {
  const send = renderToStaticMarkup(
    <ComposerPrimaryActionButton
      action={{ kind: 'send', label: 'queue', disabled: false }}
      canSend
      dir="ltr"
      label="加入后续队列"
      onSend={() => undefined}
      onStop={() => undefined}
    />,
  );
  const stop = renderToStaticMarkup(
    <ComposerPrimaryActionButton
      action={{ kind: 'stop', label: 'stop', disabled: false }}
      canSend={false}
      dir="ltr"
      label="停止"
      onSend={() => undefined}
      onStop={() => undefined}
    />,
  );

  assert.equal(send.match(/<button/g)?.length, 1);
  assert.match(send, /data-composer-primary-action="queue"/);
  assert.match(send, /aria-label="加入后续队列"/);
  assert.equal(stop.match(/<button/g)?.length, 1);
  assert.match(stop, /data-composer-primary-action="stop"/);
  assert.doesNotMatch(stop, /disabled=""/);
});
