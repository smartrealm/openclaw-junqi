import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BusinessActivityEvidence } from './BusinessActivityEvidence';

test('没有技术证据时不渲染空的展开区域', () => {
  const html = renderToStaticMarkup(createElement(BusinessActivityEvidence, { items: [] }));

  assert.equal(html, '');
});

test('低频技术证据默认收纳在可访问的渐进披露区域', () => {
  const html = renderToStaticMarkup(createElement(BusinessActivityEvidence, {
    items: [
      { label: 'Session', value: 'session-1' },
      { label: 'run', value: 'run-1' },
    ],
  }));

  assert.match(html, /^<details/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /Technical evidence/);
  assert.match(html, /<dt[^>]*>Session<\/dt>/);
  assert.match(html, /<dd[^>]*>session-1<\/dd>/);
});
