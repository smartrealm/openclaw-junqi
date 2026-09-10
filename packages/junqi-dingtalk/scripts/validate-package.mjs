import assert from "node:assert/strict";
import { access, lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "openclaw.plugin.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const toolSpecsModuleUrl = `${pathToFileURL(path.join(root, "dist", "tool-specs.js")).href}?validate=${Date.now()}`;
const eventRuntimeModuleUrl = `${pathToFileURL(path.join(root, "dist", "event-runtime.js")).href}?validate=${Date.now()}`;
const sensitivePreflightModuleUrl = `${pathToFileURL(path.join(root, "dist", "target-sensitive-readonly-preflight.js")).href}?validate=${Date.now()}`;
const {
  CONTRACT_AUDIT_TOOL_NAME,
  DINGTALK_TOOL_SPECS,
  EVENT_SNAPSHOT_TOOL_NAME,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} = await import(toolSpecsModuleUrl);
const { DINGTALK_EVENT_KEYS } = await import(eventRuntimeModuleUrl);
const {
  DINGTALK_TARGET_SENSITIVE_READ_TOOL_NAMES,
  buildDingTalkTargetSensitiveToolInvocations,
  parseDingTalkTargetSensitiveReadonlyFixture,
} = await import(sensitivePreflightModuleUrl);
const workflowSkillPath = path.join(root, "skills", "junqi-dingtalk-workflows", "SKILL.md");
const workflowSkill = await readFile(workflowSkillPath, "utf8");
const registeredToolNames = [
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
  CONTRACT_AUDIT_TOOL_NAME,
  EVENT_SNAPSHOT_TOOL_NAME,
  ...DINGTALK_TOOL_SPECS.map((spec) => spec.name),
];

assert.equal(manifest.id, "junqi-dingtalk");
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.activation?.onStartup, true);
assert.deepEqual(manifest.skills, ["./skills"]);
assert.equal(manifest.configSchema?.additionalProperties, false);
assert.deepEqual(manifest.contracts?.tools, registeredToolNames);
assert.deepEqual(manifest.configSchema?.properties?.allowedAgentIds?.default, []);
assert.deepEqual(
  manifest.configSchema?.properties?.eventSubscriptions?.items?.properties?.eventKeys?.items?.enum,
  [...DINGTALK_EVENT_KEYS],
);
assert.equal(manifest.configSchema?.properties?.eventSubscriptions?.maxItems, 8);
assert.equal(manifest.configSchema?.properties?.eventBufferSize?.minimum, 1);
assert.equal(manifest.configSchema?.properties?.eventBufferSize?.maximum, 200);
assert.deepEqual(packageJson.openclaw?.extensions, ["./dist/index.js"]);
assert.deepEqual(packageJson.files, ["dist", "skills", "openclaw.plugin.json", "README.md"]);
assert.equal(packageJson.dependencies?.typebox, "1.3.3");
const supportedOpenClawVersion = packageJson.devDependencies?.openclaw;
assert.match(supportedOpenClawVersion, /^\d{4}\.\d+\.\d+$/);
const supportedOpenClawRange = `>=${supportedOpenClawVersion}`;
assert.equal(packageJson.peerDependencies?.openclaw, supportedOpenClawRange);
assert.equal(packageJson.openclaw?.compat?.pluginApi, supportedOpenClawRange);
assert.equal(packageJson.openclaw?.compat?.minGatewayVersion, supportedOpenClawVersion);
assert.equal(packageJson.openclaw?.build?.openclawVersion, supportedOpenClawVersion);
assert.equal(packageJson.openclaw?.build?.pluginSdkVersion, supportedOpenClawVersion);
assert.equal(DINGTALK_TARGET_SENSITIVE_READ_TOOL_NAMES.length, 17);
assert.equal(typeof buildDingTalkTargetSensitiveToolInvocations, "function");
assert.equal(typeof parseDingTalkTargetSensitiveReadonlyFixture, "function");

for (const file of ["dist/index.js", "dist/index.d.ts", "dist/dws-result.js", "dist/dws-runner.js", "dist/event-rpc.js", "dist/event-runtime.js", "dist/read-result.js", "dist/schema-contract.js", "dist/target-approval-preflight.js", "dist/target-calendar-smoke.js", "dist/target-event-smoke.js", "dist/target-minutes-preflight.js", "dist/target-readonly-smoke.js", "dist/target-report-preflight.js", "dist/target-sensitive-readonly-preflight.js", "dist/target-todo-smoke.js", "dist/tool-specs.js"]) {
  await access(path.join(root, file));
}
await access(workflowSkillPath);
const workflowSkillEntry = await lstat(workflowSkillPath);
assert.equal(workflowSkillEntry.isFile(), true);
assert.equal(workflowSkillEntry.isSymbolicLink(), false);
const skillsRoot = await realpath(path.join(root, "skills"));
const workflowSkillRealPath = await realpath(workflowSkillPath);
const workflowSkillRelativePath = path.relative(skillsRoot, workflowSkillRealPath);
assert.equal(
  workflowSkillRelativePath === ".."
    || workflowSkillRelativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(workflowSkillRelativePath),
  false,
);
const workflowFrontmatterBlock = workflowSkill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
assert.ok(workflowFrontmatterBlock);
const workflowFrontmatter = Object.fromEntries(
  workflowFrontmatterBlock[1]
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const entry = line.match(/^([a-z][a-z-]*):\s+(.+)$/u);
      assert.ok(entry, `Invalid workflow Skill frontmatter entry: ${line}`);
      return [entry[1], entry[2]];
    }),
);
assert.equal(workflowFrontmatter.name, path.basename(path.dirname(workflowSkillPath)));
assert.equal(typeof workflowFrontmatter.description, "string");
assert.ok(workflowFrontmatter.description.length > 0);
assert.ok(workflowFrontmatter.description.length <= 1024);

const referencedWorkflowTools = [...workflowSkill.matchAll(/`(junqi_dingtalk_[a-z0-9_]+)`/g)]
  .map((match) => match[1]);
assert.ok(referencedWorkflowTools.length > 0);
assert.deepEqual(
  [...new Set(referencedWorkflowTools.filter((name) => !registeredToolNames.includes(name)))],
  [],
);
assert.doesNotMatch(workflowSkill, /(?:^|[\s`])dws\s+[a-z]/m);
for (const requiredTool of [
  "junqi_dingtalk_calendar_today",
  "junqi_dingtalk_todo_overdue",
  "junqi_dingtalk_todo_due_today",
  "junqi_dingtalk_approval_pending",
  "junqi_dingtalk_calendar_create",
  "junqi_dingtalk_calendar_cancel",
  "junqi_dingtalk_minutes_search",
  "junqi_dingtalk_minutes_transcript",
  "junqi_dingtalk_minutes_action_items",
  "junqi_dingtalk_todo_create",
]) {
  assert.ok(referencedWorkflowTools.includes(requiredTool));
}

const distEntries = await readdir(path.join(root, "dist"), { recursive: true });
assert.equal(distEntries.some((file) => file.endsWith(".tgz")), false);

console.log("junqi-dingtalk package contract: ok");
