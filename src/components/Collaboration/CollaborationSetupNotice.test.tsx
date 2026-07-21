import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CollaborationCapabilities } from '@/services/collaboration/types';
import {
  CollaborationSetupNotice,
  resolveCollaborationSetupReason,
} from './CollaborationSetupNotice';

function capabilities(overrides: Partial<CollaborationCapabilities> = {}): CollaborationCapabilities {
  return {
    collaborationInstanceId: 'instance-1',
    schemaVersion: 2,
    durableRuntime: true,
    configured: true,
    configuredAgents: [],
    coordinatorAgentId: 'coordinator',
    allowedAgentIds: [],
    repairs: [],
    sessionCapabilities: {
      deleteExpectedSessionId: true,
      resetExpectedSessionId: false,
    },
    ...overrides,
  };
}

test('derives setup blockers in capability order', () => {
  assert.equal(resolveCollaborationSetupReason({ loading: true }), 'loading');
  assert.equal(resolveCollaborationSetupReason({}), 'plugin-missing');
  assert.equal(resolveCollaborationSetupReason({ error: 'offline' }), 'error');
  assert.equal(resolveCollaborationSetupReason({
    capabilities: capabilities({ schemaVersion: 1 }),
    minimumSchemaVersion: 2,
  }), 'version-incompatible');
  assert.equal(resolveCollaborationSetupReason({
    capabilities: capabilities({ schemaVersion: 3 }),
    expectedSchemaVersion: 2,
  }), 'version-incompatible');
  assert.equal(resolveCollaborationSetupReason({
    capabilities: capabilities({ configured: false }),
  }), 'plugin-not-configured');
  assert.equal(resolveCollaborationSetupReason({
    capabilities: capabilities({ durableRuntime: false }),
  }), 'runtime-not-durable');
  assert.equal(resolveCollaborationSetupReason({
    capabilities: capabilities(),
    availableAgentCount: 0,
  }), 'no-agents');
  assert.equal(resolveCollaborationSetupReason({
    capabilities: capabilities(),
    availableAgentCount: 2,
  }), 'ready');
});

test('ready capability stays quiet by default and can be shown explicitly', () => {
  const hidden = renderToStaticMarkup(createElement(CollaborationSetupNotice, {
    capabilities: capabilities(),
    availableAgentCount: 2,
  }));
  assert.equal(hidden, '');

  const visible = renderToStaticMarkup(createElement(CollaborationSetupNotice, {
    capabilities: capabilities(),
    availableAgentCount: 2,
    showReady: true,
    onPrimaryAction: () => undefined,
  }));
  assert.match(visible, /data-collaboration-setup-reason="ready"/);
  assert.match(visible, /Collaboration is ready/);
});

test('renders actionable runtime and error guidance with diagnostics', () => {
  const runtime = renderToStaticMarkup(createElement(CollaborationSetupNotice, {
    capabilities: capabilities({
      durableRuntime: false,
      durableRuntimeDetails: { supported: false, reason: 'Desktop managed child' },
    }),
    onPrimaryAction: () => undefined,
  }));
  assert.match(runtime, /data-collaboration-setup-reason="runtime-not-durable"/);
  assert.match(runtime, /Persistent runtime required/);
  assert.match(runtime, /Desktop managed child/);
  assert.match(runtime, /Review runtime/);

  const error = renderToStaticMarkup(createElement(CollaborationSetupNotice, {
    error: 'RPC not registered',
    onRetry: () => undefined,
  }));
  assert.match(error, /role="alert"/);
  assert.match(error, /RPC not registered/);
  assert.match(error, />Retry</);
});

test('renders the plugin loading skeleton as a bounded status surface', () => {
  const html = renderToStaticMarkup(createElement(CollaborationSetupNotice, { loading: true }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Checking collaboration capability/);
});
