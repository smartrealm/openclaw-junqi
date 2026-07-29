import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadingIndicator } from './LoadingIndicator';

function render(props: Parameters<typeof LoadingIndicator>[0] = {}) {
  return renderToStaticMarkup(createElement(LoadingIndicator, props));
}

test('spinner is decorative by default and inherits the current color', () => {
  const html = render();
  assert.match(html, /data-loading-indicator="spinner"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /stroke="currentColor"/);
});

test('label exposes a polite loading status', () => {
  const html = render({ label: 'Loading file' });
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Loading file"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /aria-hidden/);
});

test('dots variant uses three circles and stable proportional dimensions', () => {
  const html = render({ variant: 'dots', size: 12 });
  assert.match(html, /data-loading-indicator="dots"/);
  assert.equal(html.match(/<circle/g)?.length, 3);
  assert.match(html, /width:calc\(12px \* 2\.5\);height:12px/);
});

test('string sizes support font-relative compact controls', () => {
  const html = render({ size: '1em' });
  assert.match(html, /width:1em;height:1em/);
});

test('invalid dimensions fall back to a visible stable size', () => {
  for (const size of [0, -4, Number.NaN, '']) {
    assert.match(render({ size }), /width:16px;height:16px/);
  }
});
