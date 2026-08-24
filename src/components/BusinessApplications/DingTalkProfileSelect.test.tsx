import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DingTalkProfileSelect } from './DingTalkProfileSelect';

test('DWS Profile 使用主题化共享下拉而不是系统原生选择器', () => {
  const html = renderToStaticMarkup(createElement(DingTalkProfileSelect, {
    value: 'corp-a:user-a',
    profiles: [{
      profile: 'corp-a:user-a',
      corpName: '示例组织',
      userName: '张三',
      status: 'active',
      expiresAt: null,
      isCurrent: true,
    }],
    onValueChange: () => {},
  }));

  assert.match(html, /<button[^>]+role="combobox"/);
  assert.match(html, /aria-label="执行身份（DWS Profile）"/);
  assert.match(html, /<select aria-hidden="true"/);
});
