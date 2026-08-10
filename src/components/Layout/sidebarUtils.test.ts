import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@/stores/chatStore';
import {
  extendSidebarSessionCreationFallbackOrder,
  filterSidebarSessionsByAgent,
  normalizeSidebarSessionGrouping,
  promoteSidebarSessionCreationFallbackOrder,
  projectSidebarSessions,
  resolveSidebarSessionAgentId,
  sortSessionsByActivity,
  sortSidebarSessions,
} from './sidebarUtils';

function sx(partial: Partial<Session> & { key: string }): Session {
  return {
    label: partial.key,
    ...partial,
  };
}

test('后台活动排序优先展示运行中会话，再按最近活动时间排序', () => {
  const sorted = sortSessionsByActivity([
    sx({ key: 'agent:main:old', lastTimestamp: '2026-01-01T00:00:00.000Z' }),
    sx({ key: 'agent:main:new', lastTimestamp: '2026-01-03T00:00:00.000Z' }),
    sx({ key: 'agent:main:running', running: true, lastTimestamp: '2026-01-02T00:00:00.000Z' }),
  ]);

  assert.deepEqual(sorted.map((session) => session.key), [
    'agent:main:running',
    'agent:main:new',
    'agent:main:old',
  ]);
});

test('无效分组偏好回到 OpenClaw 默认的自定义分组', () => {
  assert.equal(normalizeSidebarSessionGrouping('none'), 'none');
  assert.equal(normalizeSidebarSessionGrouping('category'), 'category');
  assert.equal(normalizeSidebarSessionGrouping('legacy-date-bucket'), 'category');
});

test('智能体范围仅保留所属会话，并保留 Gateway 确认的默认主会话', () => {
  const sessions = [
    sx({ key: 'main' }),
    sx({ key: 'agent:main:desktop-a', agentId: 'main' }),
    sx({ key: 'agent:legal:desktop-b', agentId: 'legal' }),
  ];

  assert.deepEqual(
    filterSidebarSessionsByAgent(sessions, 'main', 'main', 'main').map((session) => session.key),
    ['main', 'agent:main:desktop-a'],
  );
  assert.deepEqual(
    filterSidebarSessionsByAgent(sessions, 'legal', 'main', 'main').map((session) => session.key),
    ['agent:legal:desktop-b'],
  );
  assert.equal(resolveSidebarSessionAgentId(sessions[0], 'main', 'main'), 'main');
});

test('主会话固定在普通会话之前，且不会重复出现在置顶或分组中', () => {
  const projection = projectSidebarSessions({
    sessions: [
      sx({ key: 'agent:main:main', agentId: 'main', pinned: true, category: '重点', createdAt: 1 }),
      sx({ key: 'agent:main:pinned', agentId: 'main', pinned: true, createdAt: 2 }),
      sx({ key: 'agent:main:grouped', agentId: 'main', category: '重点', createdAt: 3 }),
      sx({ key: 'agent:main:plain', agentId: 'main', createdAt: 4 }),
    ],
    agentId: 'main',
    defaultAgentId: 'main',
    defaultMainSessionKey: 'agent:main:main',
    grouping: 'category',
    sortMode: 'created',
    categoryOrder: ['重点'],
  });

  assert.equal(projection.mainSession?.key, 'agent:main:main');
  assert.deepEqual(projection.pinnedSessions.map((session) => session.key), ['agent:main:pinned']);
  assert.deepEqual(projection.categories.map((category) => [
    category.id,
    category.sessions.map((session) => session.key),
  ]), [['重点', ['agent:main:grouped']]]);
  assert.deepEqual(projection.ungroupedSessions.map((session) => session.key), ['agent:main:plain']);
});

test('非默认智能体仅在 Gateway 返回对应主会话 key 时固定主会话', () => {
  const known = projectSidebarSessions({
    sessions: [
      sx({ key: 'agent:legal:main', agentId: 'legal' }),
      sx({ key: 'agent:legal:desktop-a', agentId: 'legal' }),
    ],
    agentId: 'legal',
    defaultAgentId: 'main',
    defaultMainSessionKey: 'agent:main:main',
    grouping: 'none',
    sortMode: 'created',
  });
  const unknown = projectSidebarSessions({
    sessions: [sx({ key: 'agent:legal:desktop-a', agentId: 'legal' })],
    agentId: 'legal',
    defaultAgentId: 'main',
    defaultMainSessionKey: 'main',
    grouping: 'none',
    sortMode: 'created',
  });

  assert.equal(known.mainSession?.key, 'agent:legal:main');
  assert.equal(unknown.mainSession, null);
  assert.deepEqual(unknown.flatSessions.map((session) => session.key), ['agent:legal:desktop-a']);
});

test('不分组模式按所选时间字段排序并保持相同时间的 Gateway 顺序', () => {
  const sessions = [
    sx({ key: 'agent:main:first', agentId: 'main', createdAt: 1, updatedAt: 4 }),
    sx({ key: 'agent:main:second', agentId: 'main', createdAt: 3, updatedAt: 2 }),
    sx({ key: 'agent:main:third', agentId: 'main', createdAt: 3, updatedAt: 5 }),
  ];

  assert.deepEqual(
    sortSidebarSessions(sessions, 'created').map((session) => session.key),
    ['agent:main:second', 'agent:main:third', 'agent:main:first'],
  );
  assert.deepEqual(
    sortSidebarSessions(sessions, 'updated').map((session) => session.key),
    ['agent:main:third', 'agent:main:first', 'agent:main:second'],
  );
});

test('创建排序在缺少 createdAt 时保持首次 Gateway 相对顺序', () => {
  const firstSnapshot = [
    sx({ key: 'agent:main:first', agentId: 'main' }),
    sx({ key: 'agent:main:second', agentId: 'main' }),
    sx({ key: 'agent:main:third', agentId: 'main' }),
  ];
  const createdOrder = extendSidebarSessionCreationFallbackOrder(new Map(), firstSnapshot);
  const refreshed = [firstSnapshot[2], firstSnapshot[0], firstSnapshot[1]];

  assert.deepEqual(
    sortSidebarSessions(refreshed, 'created', createdOrder).map((session) => session.key),
    ['agent:main:first', 'agent:main:second', 'agent:main:third'],
  );
});

test('创建排序优先使用 Gateway 创建时间而不是首次活动顺序', () => {
  const sessions = [
    sx({ key: 'agent:main:recently-active', agentId: 'main', createdAt: 1 }),
    sx({ key: 'agent:main:newly-created', agentId: 'main', createdAt: 3 }),
    sx({ key: 'agent:main:middle', agentId: 'main', createdAt: 2 }),
  ];
  const activityOrder = extendSidebarSessionCreationFallbackOrder(new Map(), sessions);

  assert.deepEqual(
    sortSidebarSessions(sessions, 'created', activityOrder).map((session) => session.key),
    [
      'agent:main:newly-created',
      'agent:main:middle',
      'agent:main:recently-active',
    ],
  );
});

test('创建时间缺失的旧会话排在可核验创建时间之后并保持稳定顺序', () => {
  const firstSnapshot = [
    sx({ key: 'agent:main:unknown-first', agentId: 'main' }),
    sx({ key: 'agent:main:known', agentId: 'main', createdAt: 2 }),
    sx({ key: 'agent:main:unknown-second', agentId: 'main' }),
  ];
  const createdOrder = extendSidebarSessionCreationFallbackOrder(new Map(), firstSnapshot);

  assert.deepEqual(
    sortSidebarSessions(firstSnapshot, 'created', createdOrder).map((session) => session.key),
    [
      'agent:main:known',
      'agent:main:unknown-first',
      'agent:main:unknown-second',
    ],
  );
});

test('已确认的新会话提升到稳定创建顺序首位', () => {
  const sessions = [
    sx({ key: 'agent:main:first', agentId: 'main' }),
    sx({ key: 'agent:main:second', agentId: 'main' }),
  ];
  const initialOrder = extendSidebarSessionCreationFallbackOrder(new Map(), sessions);
  const withCreated = extendSidebarSessionCreationFallbackOrder(initialOrder, [
    ...sessions,
    sx({ key: 'agent:main:new', agentId: 'main' }),
  ]);
  const promoted = promoteSidebarSessionCreationFallbackOrder(withCreated, 'agent:main:new');

  assert.deepEqual(
    sortSidebarSessions([
      ...sessions,
      sx({ key: 'agent:main:new', agentId: 'main' }),
    ], 'created', promoted).map((session) => session.key),
    ['agent:main:new', 'agent:main:first', 'agent:main:second'],
  );
});

test('新会话取得 Gateway 创建时间后回归官方时间排序', () => {
  const sessions = [
    sx({ key: 'agent:main:latest', agentId: 'main', createdAt: 3 }),
    sx({ key: 'agent:main:confirmed', agentId: 'main', createdAt: 2 }),
  ];
  const initialOrder = extendSidebarSessionCreationFallbackOrder(new Map(), sessions);
  const promoted = promoteSidebarSessionCreationFallbackOrder(initialOrder, 'agent:main:confirmed');

  assert.deepEqual(
    sortSidebarSessions(sessions, 'created', promoted).map((session) => session.key),
    ['agent:main:latest', 'agent:main:confirmed'],
  );
});
