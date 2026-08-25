import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeAgentTreeConnectorGeometry,
  agentTreeConnectorGeometryEqual,
  resolveAgentTreeConnectorContentRect,
} from './agentTreeConnectorGeometry';

const containerRect = { left: 0, top: 0, right: 1000, bottom: 400 };

test('滚动容器使用完整内容尺寸并把滚动偏移计入坐标原点', () => {
  assert.deepEqual(resolveAgentTreeConnectorContentRect(
    { left: 100, top: 50, right: 700, bottom: 450 },
    { scrollLeft: 20, scrollTop: 120, scrollWidth: 900, scrollHeight: 1400 },
  ), {
    left: 80,
    top: -70,
    right: 980,
    bottom: 1330,
  });
});

test('依据真实卡片矩形连接 Main -> Agent，即使换行也命中每张卡片中心', () => {
  const mainRect = { left: 460, top: 0, right: 540, bottom: 60 };
  const agentRects = new Map([
    ['agent-a', { left: 0, top: 120, right: 100, bottom: 180 }],
    // 模拟 flex-wrap 换行：agent-b 与 agent-a 不在同一行，纵坐标不同
    ['agent-b', { left: 0, top: 220, right: 100, bottom: 280 }],
  ]);

  const geometry = computeAgentTreeConnectorGeometry({
    containerRect,
    mainRect,
    agentRects,
    agentOrder: ['agent-a', 'agent-b'],
    workerEntries: [],
  });

  assert.equal(geometry.mainToAgentPaths.length, 2);
  const pathA = geometry.mainToAgentPaths.find((p) => p.key === 'agent-a');
  const pathB = geometry.mainToAgentPaths.find((p) => p.key === 'agent-b');
  assert.ok(pathA);
  assert.ok(pathB);
  // 起点必须是 main 卡片底部中心 (500, 60)
  assert.match(pathA!.d, /^M 500,60/);
  assert.match(pathB!.d, /^M 500,60/);
  // 终点必须是各自卡片的真实顶部中心，而非按单行等分假设出的坐标
  assert.match(pathA!.d, /50,120$/);
  assert.match(pathB!.d, /50,220$/);
});

test('工作会话按各自所属 Agent 的真实矩形连线，未找到父卡片时安全跳过', () => {
  const agentRects = new Map([
    ['agent-a', { left: 0, top: 100, right: 100, bottom: 160 }],
  ]);

  const geometry = computeAgentTreeConnectorGeometry({
    containerRect,
    mainRect: null,
    agentRects,
    agentOrder: ['agent-a'],
    workerEntries: [
      { key: 'w1', parentAgentId: 'agent-a', rect: { left: 20, top: 240, right: 120, bottom: 300 } },
      // 父 Agent 未在 agentRects 中找到（未渲染/尚未测量），应被安全忽略
      { key: 'w2', parentAgentId: 'missing-agent', rect: { left: 200, top: 240, right: 300, bottom: 300 } },
      // 矩形尚未测量（rect 为 null），应被安全忽略
      { key: 'w3', parentAgentId: 'agent-a', rect: null },
    ],
  });

  assert.equal(geometry.agentToWorkerPaths.length, 1);
  assert.equal(geometry.agentToWorkerPaths[0].key, 'w1');
});

test('geometry 相等性比较用于避免无谓的 state 更新', () => {
  const geometry = computeAgentTreeConnectorGeometry({
    containerRect,
    mainRect: { left: 460, top: 0, right: 540, bottom: 60 },
    agentRects: new Map([['a', { left: 0, top: 100, right: 100, bottom: 160 }]]),
    agentOrder: ['a'],
    workerEntries: [],
  });

  assert.equal(agentTreeConnectorGeometryEqual(null, geometry), false);
  assert.equal(agentTreeConnectorGeometryEqual(geometry, geometry), true);

  const changed = computeAgentTreeConnectorGeometry({
    containerRect,
    mainRect: { left: 460, top: 0, right: 540, bottom: 60 },
    agentRects: new Map([['a', { left: 10, top: 100, right: 110, bottom: 160 }]]),
    agentOrder: ['a'],
    workerEntries: [],
  });
  assert.equal(agentTreeConnectorGeometryEqual(geometry, changed), false);
});

test('没有 Worker 归属父节点且无 mainRect 兜底时跳过该 Worker', () => {
  const geometry = computeAgentTreeConnectorGeometry({
    containerRect,
    mainRect: null,
    agentRects: new Map(),
    agentOrder: [],
    workerEntries: [
      { key: 'orphan', parentAgentId: null, rect: { left: 0, top: 0, right: 10, bottom: 10 } },
    ],
  });
  assert.equal(geometry.agentToWorkerPaths.length, 0);
});
