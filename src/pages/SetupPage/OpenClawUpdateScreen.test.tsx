import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenClawUpdateContinuationFailure } from './OpenClawUpdateContinuationFailure';

test('跳过更新后的配置准备失败会在当前页面就地呈现', () => {
  const html = renderToStaticMarkup(
    <OpenClawUpdateContinuationFailure message="OpenClaw 官方向导启动失败。" />,
  );

  assert.match(html, /OpenClaw 官方向导启动失败。/);
  assert.match(html, /未能进入 OpenClaw 配置|Could not open OpenClaw setup/);
});
