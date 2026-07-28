import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlassCard, GlassCardEnterMotionScope } from './GlassCard';

test('glass card enter motion can be disabled for a stable tab content scope', () => {
  const animated = renderToStaticMarkup(createElement(GlassCard, null, 'content'));
  const stable = renderToStaticMarkup(createElement(
    GlassCardEnterMotionScope,
    {
      enabled: false,
      children: createElement(GlassCard, { delay: 0.2, children: 'content' }),
    },
  ));

  assert.match(animated, /animate-slide-up/);
  assert.doesNotMatch(stable, /animate-slide-up/);
  assert.doesNotMatch(stable, /animation-delay/);
});
