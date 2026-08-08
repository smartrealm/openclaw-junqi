import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import { DwsRunner, normalizeRunnerConfig, validateProfileReference } from "./dws-runner.js";
import { serializeRuntimeError } from "./errors.js";
import { buildSchemaValidatedArguments, DwsSchemaRegistry } from "./schema-contract.js";
import {
  DINGTALK_TOOL_SPECS,
  DINGTALK_TOOL_SPEC_BY_NAME,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} from "./tool-specs.js";
import type { DingTalkToolSpec } from "./types.js";

const PLUGIN_ID = "junqi-dingtalk";
const PLUGIN_NAME = "JunQi DingTalk Business";
const PLUGIN_DESCRIPTION = "DingTalk business tools executed by DWS through OpenClaw.";

const TOOL_PARAMETERS = Type.Object({
  profile: Type.String({
    description: "Exact DWS profile in <corpId>:<userId> form",
    pattern: "^[^:\\s]+:[^:\\s]+$",
  }),
  arguments: Type.Record(Type.String(), Type.Unknown(), {
    description: "Named DWS leaf-schema parameters without leading dashes",
  }),
}, { additionalProperties: false });

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findProfileRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(findProfileRecords);
  if (!isRecord(value)) return [];
  const corpId = value.corpId ?? value.corp_id;
  const userId = value.userId ?? value.user_id;
  const current = typeof corpId === "string" && typeof userId === "string"
    ? [{
        corpId,
        userId,
        ...(typeof value.corpName === "string" ? { corpName: value.corpName } : {}),
        ...(typeof value.userName === "string" ? { userName: value.userName } : {}),
      }]
    : [];
  return [...current, ...Object.values(value).flatMap(findProfileRecords)];
}

async function probeRuntime(runner: DwsRunner): Promise<Record<string, unknown>> {
  const executable = await runner.resolveExecutable();
  const probe = async (command: readonly string[]): Promise<unknown> => {
    try {
      return (await runner.run(command)).data;
    } catch (error) {
      return { success: false, error: serializeRuntimeError(error) };
    }
  };
  const [version, authStatus, profileList] = await Promise.all([
    probe(["version"]),
    probe(["auth", "status"]),
    probe(["profile", "list"]),
  ]);
  const profiles = findProfileRecords(profileList)
    .filter((profile, index, items) => items.findIndex((candidate) => (
      candidate.corpId === profile.corpId && candidate.userId === profile.userId
    )) === index);
  return {
    executable,
    version,
    authStatus,
    profiles,
  };
}

function resultEnvelope(spec: DingTalkToolSpec, profile: string, digest: string, result: {
  data: unknown;
  recoveryEventId?: string;
}): Record<string, unknown> {
  return {
    success: true,
    toolName: spec.name,
    dwsCanonicalPath: spec.canonicalPath,
    profileRef: profile,
    schemaDigest: digest,
    observedAt: new Date().toISOString(),
    data: result.data,
    ...(result.recoveryEventId ? { recoveryEventId: result.recoveryEventId } : {}),
  };
}

function toolResult(details: Record<string, unknown>): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

export function createJunqiDingTalkPlugin(): OpenClawPluginDefinition {
  return definePluginEntry({
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    register(api) {
      if (api.registrationMode !== "full") return;
      const runner = new DwsRunner(normalizeRunnerConfig(api.pluginConfig));
      const schemas = new DwsSchemaRegistry(runner);

      api.registerTool({
        name: RUNTIME_STATUS_TOOL_NAME,
        label: "钉钉运行状态",
        description: "检查固定 DWS 可执行文件、认证状态和可用租户身份",
        parameters: Type.Object({}, { additionalProperties: false }),
        async execute() {
          return toolResult({
            success: true,
            toolName: RUNTIME_STATUS_TOOL_NAME,
            observedAt: new Date().toISOString(),
            runtime: await probeRuntime(runner),
          });
        },
      });
      api.registerToolMetadata({
        toolName: RUNTIME_STATUS_TOOL_NAME,
        displayName: "钉钉运行状态",
        description: "检查 DWS 运行时、认证状态和租户身份",
        risk: "low",
        tags: ["dingtalk", "runtime", "read"],
      });

      api.registerTool({
        name: TOOL_SCHEMA_TOOL_NAME,
        label: "钉钉工具参数",
        description: "读取一个已注册钉钉业务工具的当前 DWS 参数契约",
        parameters: Type.Object({
          toolName: Type.String({ minLength: 1 }),
        }, { additionalProperties: false }),
        async execute(_toolCallId, params) {
          if (!isRecord(params) || typeof params.toolName !== "string") {
            throw new TypeError("DingTalk schema tool requires a toolName");
          }
          const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(params.toolName);
          if (!spec) throw new TypeError("DingTalk schema tool does not recognize this tool");
          const verified = await schemas.verify(spec);
          return toolResult({
            success: true,
            toolName: spec.name,
            dwsCanonicalPath: spec.canonicalPath,
            schemaDigest: verified.digest,
            effect: spec.effect,
            risk: spec.risk,
            confirmation: spec.confirmation,
            idempotency: spec.idempotency,
            parameters: verified.schema.parameters ?? {},
          });
        },
      });
      api.registerToolMetadata({
        toolName: TOOL_SCHEMA_TOOL_NAME,
        displayName: "钉钉工具参数",
        description: "读取已注册钉钉业务工具的当前 DWS 参数契约",
        risk: "low",
        tags: ["dingtalk", "runtime", "read", "internal"],
      });

      for (const spec of DINGTALK_TOOL_SPECS) {
        api.registerTool({
          name: spec.name,
          label: spec.label,
          description: spec.description,
          parameters: TOOL_PARAMETERS,
          async execute(_toolCallId, params, signal) {
            if (!isRecord(params)) {
              throw new TypeError("DingTalk tool parameters must be an object");
            }
            const profile = validateProfileReference(params.profile);
            const verified = await schemas.verify(spec);
            const businessArgs = buildSchemaValidatedArguments(verified.schema, params.arguments);
            const result = await runner.run(
              [...spec.cliPath.split(" "), ...businessArgs],
              {
                profile,
                confirmed: spec.confirmation === "user_required",
                ...(signal ? { signal } : {}),
              },
            );
            return toolResult(resultEnvelope(spec, profile, verified.digest, result));
          },
        });
        api.registerToolMetadata({
          toolName: spec.name,
          displayName: spec.label,
          description: spec.description,
          risk: spec.risk,
          tags: ["dingtalk", spec.domain, spec.effect],
        });
      }

      api.on("before_tool_call", (event) => {
        const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(event.toolName);
        if (!spec || spec.effect === "read") return;
        const profile = typeof event.params.profile === "string" ? event.params.profile : "未提供";
        return {
          requireApproval: {
            title: spec.label,
            description: `即将通过 DWS 对租户身份 ${profile} 执行${spec.description}。`,
            severity: spec.risk === "high" ? "critical" : "warning",
            timeoutMs: 300_000,
            timeoutBehavior: "deny",
            timeoutReason: "钉钉业务操作审批已超时",
            allowedDecisions: ["allow-once", "deny"],
            pluginId: PLUGIN_ID,
          },
        };
      });
    },
  });
}

const plugin: OpenClawPluginDefinition = createJunqiDingTalkPlugin();

export default plugin;
export {
  DINGTALK_TOOL_SPECS,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} from "./tool-specs.js";
