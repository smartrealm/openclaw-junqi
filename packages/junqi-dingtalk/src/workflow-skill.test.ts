import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CONTRACT_AUDIT_TOOL_NAME,
  DINGTALK_TOOL_SPECS,
  EVENT_SNAPSHOT_TOOL_NAME,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} from "./tool-specs.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = path.join(packageRoot, "skills", "junqi-dingtalk-workflows", "SKILL.md");

test("工作流 Skill 只引用已注册的固定钉钉工具", async () => {
  const source = await readFile(skillPath, "utf8");
  const registered = new Set([
    RUNTIME_STATUS_TOOL_NAME,
    TOOL_SCHEMA_TOOL_NAME,
    CONTRACT_AUDIT_TOOL_NAME,
    EVENT_SNAPSHOT_TOOL_NAME,
    ...DINGTALK_TOOL_SPECS.map((spec) => spec.name),
  ]);
  const referenced = [...source.matchAll(/`(junqi_dingtalk_[a-z0-9_]+)`/g)]
    .map((match) => match[1])
    .filter((name): name is string => typeof name === "string");

  assert.ok(referenced.length > 0);
  assert.deepEqual(
    [...new Set(referenced.filter((name) => !registered.has(name)))],
    [],
  );
  assert.doesNotMatch(source, /(?:^|[\s`])dws\s+[a-z]/m);
});

test("插件正式声明并打包工作流 Skill", async () => {
  const [manifestSource, packageSource] = await Promise.all([
    readFile(path.join(packageRoot, "openclaw.plugin.json"), "utf8"),
    readFile(path.join(packageRoot, "package.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource) as { skills?: unknown };
  const packageJson = JSON.parse(packageSource) as { files?: unknown };

  assert.deepEqual(manifest.skills, ["./skills"]);
  assert.deepEqual(packageJson.files, ["dist", "skills", "openclaw.plugin.json", "README.md"]);
});

test("工作流 Skill 满足 OpenClaw 加载器的必填元数据", async () => {
  const source = await readFile(skillPath, "utf8");
  const frontmatterBlock = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  assert.ok(frontmatterBlock);
  const frontmatter = Object.fromEntries(
    frontmatterBlock[1]
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const entry = line.match(/^([a-z][a-z-]*):\s+(.+)$/u);
        assert.ok(entry);
        return [entry[1], entry[2]];
      }),
  );

  assert.equal(frontmatter.name, "junqi-dingtalk-workflows");
  assert.equal(typeof frontmatter.description, "string");
  assert.ok(frontmatter.description.length > 0);
  assert.ok(frontmatter.description.length <= 1024);
});

test("每日工作助理覆盖逾期与今日到期待办且保持只读", async () => {
  const source = await readFile(skillPath, "utf8");
  const section = source.match(/## Daily work assistant\n([\s\S]*?)(?=\n## |$)/u)?.[1];
  assert.ok(section);

  const referenced = [...section.matchAll(/`(junqi_dingtalk_[a-z0-9_]+)`/g)]
    .map((match) => match[1]);
  assert.deepEqual(referenced, [
    "junqi_dingtalk_calendar_today",
    "junqi_dingtalk_todo_overdue",
    "junqi_dingtalk_todo_due_today",
    "junqi_dingtalk_approval_pending",
  ]);

  const specs = referenced.map((name) => DINGTALK_TOOL_SPECS.find((spec) => spec.name === name));
  assert.equal(specs.every((spec) => (
    spec?.effect === "read"
    && spec.risk === "low"
    && spec.confirmation === "not_required"
    && spec.idempotency === "idempotent"
  )), true);
  assert.match(section, /If one source fails/u);
  assert.match(section, /Do not perform writes/u);
});

test("会议工作流覆盖创建、变更和核验后取消", async () => {
  const source = await readFile(skillPath, "utf8");
  const section = source.match(/## Meeting planning and creation\n([\s\S]*?)(?=\n## |$)/u)?.[1];
  assert.ok(section);

  for (const toolName of [
    "junqi_dingtalk_calendar_create",
    "junqi_dingtalk_calendar_update",
    "junqi_dingtalk_calendar_cancel",
    "junqi_dingtalk_calendar_event",
    "junqi_dingtalk_calendar_attendees",
  ]) {
    assert.equal(section.includes("`" + toolName + "`"), true);
  }
  assert.match(section, /explicitly requests deletion/u);
  assert.match(section, /must never be retried automatically/u);
});

test("听记闭环要求同一任务的完整逐字稿证据", async () => {
  const source = await readFile(skillPath, "utf8");
  const section = source.match(/## Meeting Minutes and follow-up\n([\s\S]*?)(?=\n## |$)/u)?.[1];
  assert.ok(section);

  for (const toolName of [
    "junqi_dingtalk_minutes_search",
    "junqi_dingtalk_minutes_detail",
    "junqi_dingtalk_minutes_transcript",
    "junqi_dingtalk_minutes_action_items",
  ]) {
    assert.equal(section.includes("`" + toolName + "`"), true);
  }
  assert.match(section, /exact task identifier/u);
  assert.match(section, /never request the latest item/u);
  assert.match(section, /`taskUuid` matches/u);
  assert.match(section, /`complete` is true/u);
});
