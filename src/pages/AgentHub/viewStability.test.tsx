import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentHubViewPanel,
  hasAgentHubSnapshot,
  shouldShowAgentHubInitialLoading,
} from "./viewStability";

test("Agent Hub 只在首份完整快照到达前阻塞加载", () => {
  assert.equal(hasAgentHubSnapshot({ sessions: 1, agents: 1 }), true);
  assert.equal(hasAgentHubSnapshot({ sessions: 1, agents: 0 }), false);
  assert.equal(shouldShowAgentHubInitialLoading(true, false), true);
  assert.equal(shouldShowAgentHubInitialLoading(true, true), false);
  assert.equal(shouldShowAgentHubInitialLoading(false, false), false);
});

test("非当前 Agent Hub 视图保持挂载但不参与展示和无障碍树", () => {
  const visible = renderToStaticMarkup(
    <AgentHubViewPanel active><span>tree-content</span></AgentHubViewPanel>,
  );
  const hidden = renderToStaticMarkup(
    <AgentHubViewPanel active={false}><span>grid-content</span></AgentHubViewPanel>,
  );

  assert.match(visible, /tree-content/);
  assert.doesNotMatch(visible, /<div hidden/);
  assert.doesNotMatch(visible, /aria-hidden/);
  assert.match(hidden, /hidden=""/);
  assert.match(hidden, /aria-hidden="true"/);
  assert.match(hidden, /grid-content/);
});
