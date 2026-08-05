import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentActivityIndicator,
  activityOrbState,
  activityOrbTheme,
} from './AgentActivityIndicator';

test('maps only verified JunQi activity states to orb presets', () => {
  assert.equal(activityOrbState('thinking'), 'breathing');
  assert.equal(activityOrbState('generating'), 'composing');
  assert.equal(activityOrbState('working'), 'working');
  assert.equal(activityOrbState('listening'), 'listening');
});

test('maps Aegis themes without relying on the operating system preference', () => {
  assert.equal(activityOrbTheme('aegis-dark'), 'dark');
  assert.equal(activityOrbTheme('aegis-midnight'), 'dark');
  assert.equal(activityOrbTheme('aegis-light'), 'light');
  assert.equal(activityOrbTheme('aegis-eyecare'), 'light');
});

test('decorative activity indicator does not duplicate visible status text', () => {
  const html = renderToStaticMarkup(createElement(AgentActivityIndicator, {
    activity: 'thinking',
    decorative: true,
  }));
  assert.match(html, /data-agent-activity="thinking"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /role="presentation"/);
  assert.doesNotMatch(html, /aria-live/);
});

test('standalone activity indicator exposes a polite localized status', () => {
  const html = renderToStaticMarkup(createElement(AgentActivityIndicator, {
    activity: 'working',
    label: 'Agent is working',
  }));
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Agent is working"/);
  assert.match(html, /aria-live="polite"/);
});

test('business surfaces consume only the JunQi wrapper', () => {
  const files = [
    '../Chat/ThinkingBubble.tsx',
    '../Chat/ExecutionProcessGroup.tsx',
    '../../dynamic-island/DynamicIsland.tsx',
    '../../pages/AgentHub/index.tsx',
  ];
  for (const path of files) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]thinking-orbs['"]/);
    assert.match(source, /AgentActivityIndicator/);
  }
});
