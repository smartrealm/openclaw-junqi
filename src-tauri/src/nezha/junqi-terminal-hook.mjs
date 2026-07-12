#!/usr/bin/env node
// Managed Claude Code hook for JunQi terminal sessions. It has no effect
// outside a terminal carrying the per-run bridge environment.

import net from "node:net";

const port = Number.parseInt(process.env.JUNQI_HOOK_PORT || "", 10);
const token = process.env.JUNQI_HOOK_TOKEN || "";
const surface = process.env.JUNQI_SURFACE_ID || "";
const runId = process.env.JUNQI_HOOK_RUN_ID || "";
if (!Number.isInteger(port) || port < 1 || port > 65535 || !token || !surface || !runId) {
  process.exit(0);
}

let raw = "";
let finished = false;

function pick(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function toolIdentifier(name, input) {
  if (!input || typeof input !== "object") return "";
  const get = (...keys) => keys.map((key) => input[key]).find((value) => typeof value === "string" && value) || "";
  switch (name.toLowerCase()) {
    case "bash": return get("command");
    case "read": case "write": case "edit": case "glob": return get("file_path", "path", "pattern");
    case "grep": case "search": return get("pattern", "query");
    default: {
      for (const key of Object.keys(input).sort()) {
        if (typeof input[key] === "string" && input[key]) return input[key];
      }
      return "";
    }
  }
}

function lifecycle(event) {
  if (event === "SessionStart" || event === "UserPromptSubmit") return "running";
  if (event === "Stop" || event === "Notification") return "attention";
  if (event === "SessionEnd") return "ended";
  return "";
}

function send(message) {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  const timeout = setTimeout(() => socket.destroy(), 350);
  socket.on("connect", () => socket.end(JSON.stringify(message)));
  socket.on("error", () => {});
  socket.on("close", () => clearTimeout(timeout));
}

function finish() {
  if (finished) return;
  finished = true;
  try {
    const payload = raw ? JSON.parse(raw) : {};
    const hookEvent = pick(payload, "hook_event_name", "hookEventName", "event");
    const base = { token, surface, run_id: runId, agent: "claude" };
    const state = lifecycle(hookEvent);
    if (state) {
      send({ ...base, kind: "lifecycle", event: state });
    } else if (hookEvent === "PreToolUse" || hookEvent === "PostToolUse" || hookEvent === "PostToolUseFailure") {
      const toolName = pick(payload, "tool_name", "toolName");
      if (toolName) {
        send({
          ...base,
          kind: "tool",
          event: hookEvent === "PreToolUse" ? "pre" : "post",
          tool_name: toolName,
          identifier: toolIdentifier(toolName, payload.tool_input ?? payload.toolInput),
          success: hookEvent !== "PostToolUseFailure" && payload.is_error !== true && payload.isError !== true,
          tool_use_id: pick(payload, "tool_use_id", "toolUseId"),
        });
      }
    }
  } catch {
    // A hook must never make Claude fail.
  }
  process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", finish);
process.stdin.on("error", finish);
process.on("uncaughtException", finish);
