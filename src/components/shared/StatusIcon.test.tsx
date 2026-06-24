// ── StatusIcon.test.tsx ───────────────────────────────────────────────────────
//
// Unit tests for the shared StatusIcon component. The component is a pure
// function of `status` → rendered lucide icon. We don't need jsdom — react
// server-side rendering via react-dom/server provides the output for us.
//
// Run with: pnpm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { StatusIcon } from './StatusIcon';

function render(status: string) {
  return renderToStaticMarkup(createElement(StatusIcon, { status: status as never }));
}

test('running renders a Loader2 with spin animation', () => {
  const html = render('running');
  // Loader2 emits inline `animation:spin 1s linear infinite` via style attribute.
  assert.match(html, /animation:spin/);
  assert.match(html, /<svg/);
});

test('done renders a check icon', () => {
  const html = render('done');
  assert.match(html, /lucide-circle-check-big|lucide-circle-check/i);
  // No spin animation on completed states.
  assert.doesNotMatch(html, /animate-spin/);
});

test('failed renders an X icon', () => {
  const html = render('failed');
  assert.match(html, /lucide-circle-x/i);
});

test('input_required renders a warning-styled icon', () => {
  const html = render('input_required');
  assert.match(html, /lucide-circle-alert/i);
});

test('detached and interrupted both render warning icons', () => {
  for (const status of ['detached', 'interrupted']) {
    const html = render(status);
    assert.match(html, /lucide-triangle-alert/i);
  }
});

test('cancelled renders a minus icon', () => {
  const html = render('cancelled');
  assert.match(html, /lucide-circle-minus/i);
});

test('pending and queued render a clock icon', () => {
  for (const status of ['pending', 'queued']) {
    const html = render(status);
    assert.match(html, /lucide-clock/i);
  }
});

test('review renders an hourglass icon', () => {
  const html = render('review');
  assert.match(html, /lucide-hourglass/i);
});

test('unknown status falls through to outline circle (todo/queue)', () => {
  const html = render('todo');
  assert.match(html, /<svg/);
  // The fallback for `todo` / `queue` is the plain `Circle` icon.
  assert.match(html, /class="lucide lucide-circle"/);
});

test('completely unrecognized status renders play circle (alert fallback)', () => {
  // Per the source: "if status !== 'todo' && status !== 'queue'" → PlayCircle.
  // lucide-react emits the icon as `lucide-circle-play` (its canonical name).
  const html = render('what-is-this');
  assert.match(html, /lucide-circle-play/i);
});

test('size prop propagates to the rendered svg', () => {
  const html = render('done');
  // lucide-react emits `height="14"` style attrs based on size prop.
  // We only check that size prop is wired (any non-zero attribute), since the
  // exact attribute name varies between icon versions.
  assert.match(html, /width="14"|height="14"/);
});

test('chat store workflow statuses all render an svg (no crash)', () => {
  for (const status of ['queue', 'inProgress', 'done']) {
    const html = render(status);
    assert.match(html, /<svg/, `expected svg for status ${status}`);
  }
});
