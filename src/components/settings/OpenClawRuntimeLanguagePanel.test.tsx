import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenClawRuntimeLanguagePanel } from './OpenClawRuntimeLanguagePanel';

const noOp = () => undefined;

test('运行时语言面板展示官方三种语言并锁定未变更的保存操作', () => {
  const html = renderToStaticMarkup(
    <OpenClawRuntimeLanguagePanel
      connected
      currentLocale="zh-CN"
      selectedLocale="zh-CN"
      rawLocale="zh-CN"
      loading={false}
      saving={false}
      message={null}
      onSelectLocale={noOp}
      onRefresh={noOp}
      onSave={noOp}
    />,
  );

  assert.match(html, /role="radiogroup"/);
  assert.match(html, /English/);
  assert.match(html, /简体中文/);
  assert.match(html, /繁體中文/);
  assert.match(html, /Save and apply/);
  assert.match(html, /disabled=""/);
});

test('未知运行时语言保留原值且不推断为受支持语言', () => {
  const html = renderToStaticMarkup(
    <OpenClawRuntimeLanguagePanel
      connected
      currentLocale={null}
      selectedLocale={null}
      rawLocale="ja-JP"
      loading={false}
      saving={false}
      message={null}
      onSelectLocale={noOp}
      onRefresh={noOp}
      onSave={noOp}
    />,
  );

  assert.match(html, /ja-JP/);
  assert.match(html, /unrecognized language/);
  assert.doesNotMatch(html, /aria-checked="true"/);
});

test('断开连接时只展示真实不可用状态', () => {
  const html = renderToStaticMarkup(
    <OpenClawRuntimeLanguagePanel
      connected={false}
      currentLocale={null}
      selectedLocale={null}
      rawLocale={null}
      loading={false}
      saving={false}
      message={null}
      onSelectLocale={noOp}
      onRefresh={noOp}
      onSave={noOp}
    />,
  );

  assert.match(html, /Connect and verify the Gateway identity/);
  assert.doesNotMatch(html, /role="radiogroup"/);
});
