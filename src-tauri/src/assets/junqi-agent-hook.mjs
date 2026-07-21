#!/usr/bin/env node
// JunQi hook bridge. It is inert outside a JunQi-launched agent task.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const taskId = process.env.JUNQI_TASK_ID;
const eventDir = process.env.JUNQI_EVENT_DIR;
if (!taskId || !eventDir) {
  process.exit(0);
}

const pick = (payload, ...keys) => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
};

let raw = "";
let done = false;

function finish() {
  if (done) return;
  done = true;
  try {
    const payload = raw ? JSON.parse(raw) : {};
    const line =
      JSON.stringify({
        ts: Date.now(),
        task_id: taskId,
        agent: process.env.JUNQI_AGENT || "",
        event: pick(payload, "hook_event_name", "event_name", "hookEventName", "event"),
        session_id:
          pick(payload, "session_id", "conversation_id", "sessionId", "conversationId") ||
          process.env.CODEX_SESSION_ID ||
          process.env.CLAUDE_CODE_SESSION_ID ||
          "",
        transcript_path: pick(payload, "transcript_path", "transcriptPath", "rollout_path"),
        cwd: pick(payload, "cwd"),
        tool_name: pick(payload, "tool_name", "toolName"),
        permission_mode: pick(payload, "permission_mode", "permissionMode"),
        notification_type: pick(payload, "notification_type", "notificationType"),
      }) + "\n";
    mkdirSync(eventDir, { recursive: true });
    appendFileSync(join(eventDir, "events.jsonl"), line);
  } catch {
    // Hooks must never block or fail an agent invocation.
  }
  process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", finish);
process.stdin.on("error", finish);
process.on("uncaughtException", finish);
