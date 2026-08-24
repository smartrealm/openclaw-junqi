import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMessageBlock } from './SessionViewPage';

test('会话回放不会执行 transcript 中的原始 HTML', () => {
  const html = renderToStaticMarkup(<AssistantMessageBlock content={[{
    type: 'text',
    text: '<img src="x" onerror="globalThis.compromised=true"><script>globalThis.compromised=true</script>',
  }]} />);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});
