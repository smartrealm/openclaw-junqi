import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentWorkspaceTodoTaskView } from "./TodoTaskView";
import type { AgentWorkspaceTask } from "@/stores/agentWorkspaceStore";

test("todo task view exposes summary, edit, and immediate run controls", () => {
  const task: AgentWorkspaceTask = {
    id: "todo-1",
    projectPath: "/repo",
    title: "Review auth flow",
    prompt: "Review the authentication flow and add tests.",
    agent: "codex",
    permissionMode: "auto_edit",
    status: "todo",
    createdAt: 1,
    updatedAt: 1,
  };
  const html = renderToStaticMarkup(createElement(AgentWorkspaceTodoTaskView, {
    task,
    onEdit: () => {},
    onRun: () => {},
  }));

  assert.match(html, /待办任务/);
  assert.match(html, /Review the authentication flow/);
  assert.match(html, /Codex/);
  assert.match(html, /自动编辑/);
  assert.match(html, /立即运行/);
});
