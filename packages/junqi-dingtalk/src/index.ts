import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import { DwsRunner, normalizeRunnerConfig, validateProfileReference } from "./dws-runner.js";
import { DingTalkRuntimeError } from "./errors.js";
import { agentAuthorizationFailure, normalizeAllowedAgentIds } from "./agent-authorization.js";
import { probeDwsRuntime } from "./runtime-probe.js";
import { buildSchemaValidatedArguments, DwsSchemaRegistry } from "./schema-contract.js";
import {
  assertDingTalkWriteReconciliationAvailable,
  reconcileDingTalkWrite,
} from "./write-reconciliation.js";
import {
  dingTalkWriteApprovalDescription,
  serializeDingTalkContractAnalysisInput,
  validateDingTalkInvocationPolicy,
} from "./invocation-policy.js";
import { auditDingTalkContracts } from "./contract-audit.js";
import { assertDingTalkReadResult } from "./read-result.js";
import { DingTalkEventRuntime, normalizeDingTalkEventConfig } from "./event-runtime.js";
import { registerDingTalkEventSnapshotRpc } from "./event-rpc.js";
import {
  CONTRACT_AUDIT_TOOL_NAME,
  DINGTALK_TOOL_SPECS,
  DINGTALK_TOOL_SPEC_BY_NAME,
  EVENT_SNAPSHOT_TOOL_NAME,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} from "./tool-specs.js";
import type {
  DingTalkToolSpec,
  DingTalkWriteVerification,
  DwsEffect,
  DwsLeafSchema,
} from "./types.js";

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

function resultEnvelope(spec: DingTalkToolSpec, profile: string, digest: string, result: {
  data: unknown;
  recoveryEventId?: string;
}, verification?: DingTalkWriteVerification): Record<string, unknown> {
  return {
    success: true,
    toolName: spec.name,
    dwsCanonicalPath: spec.canonicalPath,
    profileRef: profile,
    schemaDigest: digest,
    observedAt: new Date().toISOString(),
    data: result.data,
    ...(verification ? { verification } : {}),
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

export function shouldRegisterDingTalkTools(
  registrationMode: OpenClawPluginApi["registrationMode"],
): boolean {
  return (
    registrationMode === "full" ||
    registrationMode === "discovery" ||
    registrationMode === "tool-discovery"
  );
}

export function shouldRegisterDingTalkEventService(
  registrationMode: OpenClawPluginApi["registrationMode"],
): boolean {
  return registrationMode === "full";
}

export function hasDingTalkSideEffect(effect: DwsEffect): boolean {
  return effect !== "read";
}

export function prepareDingTalkExecution(
  spec: DingTalkToolSpec,
  argumentsValue: unknown,
): { readonly arguments: unknown; readonly stdin?: string } {
  if (spec.name === "junqi_dingtalk_contract_review_analysis") {
    return {
      arguments: { file: "-" },
      stdin: serializeDingTalkContractAnalysisInput(argumentsValue),
    };
  }
  if (spec.name !== "junqi_dingtalk_report_submit" || !isRecord(argumentsValue)) {
    return { arguments: argumentsValue };
  }
  const contents = argumentsValue.contents;
  if (typeof contents !== "string") return { arguments: argumentsValue };
  return {
    arguments: { ...argumentsValue, contents: "-" },
    stdin: contents,
  };
}

export async function prepareDingTalkWriteApproval(
  spec: DingTalkToolSpec,
  params: unknown,
  schemas: {
    verify(candidate: DingTalkToolSpec): Promise<{
      readonly schema: DwsLeafSchema;
      readonly digest: string;
    }>;
  },
): Promise<{ readonly profile: string; readonly description: string }> {
  if (!isRecord(params)) {
    throw new DingTalkRuntimeError("DWS_ARGUMENTS_REQUIRED", "DingTalk tool parameters must be an object");
  }
  const profile = validateProfileReference(params.profile);
  validateDingTalkInvocationPolicy(spec, params.arguments);
  assertDingTalkWriteReconciliationAvailable(spec);
  const verified = await schemas.verify(spec);
  buildSchemaValidatedArguments(verified.schema, params.arguments);
  return {
    profile,
    description: dingTalkWriteApprovalDescription(spec, profile, params.arguments),
  };
}

export function createJunqiDingTalkPlugin() {
  return definePluginEntry({
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    register(api) {
      if (!shouldRegisterDingTalkTools(api.registrationMode)) return;
      const runner = new DwsRunner(normalizeRunnerConfig(api.pluginConfig));
      const schemas = new DwsSchemaRegistry(runner);
      const allowedAgentIds = normalizeAllowedAgentIds(api.pluginConfig);
      const eventRuntime = new DingTalkEventRuntime(
        runner,
        normalizeDingTalkEventConfig(api.pluginConfig),
      );

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
            runtime: await probeDwsRuntime(runner),
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
            constraints: verified.schema.constraints ?? {},
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

      api.registerTool({
        name: CONTRACT_AUDIT_TOOL_NAME,
        label: "钉钉契约审计",
        description: "逐项核验全部已注册钉钉业务工具与目标 DWS 叶子 Schema",
        parameters: Type.Object({}, { additionalProperties: false }),
        async execute() {
          const audit = await auditDingTalkContracts(schemas, DINGTALK_TOOL_SPECS);
          return toolResult({
            success: audit.failedCount === 0,
            toolName: CONTRACT_AUDIT_TOOL_NAME,
            observedAt: new Date().toISOString(),
            audit,
          });
        },
      });
      api.registerToolMetadata({
        toolName: CONTRACT_AUDIT_TOOL_NAME,
        displayName: "钉钉契约审计",
        description: "逐项核验目标 DWS 是否满足全部已注册工具契约",
        risk: "low",
        tags: ["dingtalk", "runtime", "read", "internal"],
      });

      api.registerTool({
        name: EVENT_SNAPSHOT_TOOL_NAME,
        label: "钉钉事件快照",
        description: "读取当前 Gateway 生命周期内的钉钉事件运行状态和有界事件快照",
        parameters: Type.Object({
          afterSequence: Type.Optional(Type.Integer({ minimum: 0 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
        }, { additionalProperties: false }),
        async execute(_toolCallId, params) {
          const source = isRecord(params) ? params : {};
          const afterSequence = typeof source.afterSequence === "number" ? source.afterSequence : 0;
          const limit = typeof source.limit === "number" ? source.limit : 20;
          return toolResult({
            success: true,
            toolName: EVENT_SNAPSHOT_TOOL_NAME,
            observedAt: new Date().toISOString(),
            runtime: eventRuntime.snapshot(afterSequence, limit),
          });
        },
      });
      api.registerToolMetadata({
        toolName: EVENT_SNAPSHOT_TOOL_NAME,
        displayName: "钉钉事件快照",
        description: "读取内存中的钉钉事件和消费进程状态",
        risk: "low",
        tags: ["dingtalk", "runtime", "read", "internal"],
      });

      if (shouldRegisterDingTalkEventService(api.registrationMode)) {
        registerDingTalkEventSnapshotRpc(api, eventRuntime);
        api.registerService({
          id: "junqi-dingtalk-events",
          async start(context) {
            await eventRuntime.start(context);
          },
          async stop() {
            await eventRuntime.stop();
          },
        });
      }

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
            validateDingTalkInvocationPolicy(spec, params.arguments);
            assertDingTalkWriteReconciliationAvailable(spec);
            const verified = await schemas.verify(spec);
            const execution = prepareDingTalkExecution(spec, params.arguments);
            const businessArgs = buildSchemaValidatedArguments(verified.schema, execution.arguments);
            const sideEffect = hasDingTalkSideEffect(spec.effect);
            const result = await runner.run(
              [...spec.cliPath.split(" "), ...businessArgs],
              {
                profile,
                confirmed: spec.confirmation === "user_required",
                sideEffect,
                ...(execution.stdin !== undefined ? { stdin: execution.stdin } : {}),
                ...(signal ? { signal } : {}),
              },
            );
            assertDingTalkReadResult(spec, result, params.arguments);
            const verification = sideEffect
              ? await reconcileDingTalkWrite({
                  spec,
                  profile,
                  arguments: params.arguments,
                  writeResult: result,
                  writeSchemaDigest: verified.digest,
                  schemas,
                  runner,
                })
              : undefined;
            return toolResult(resultEnvelope(spec, profile, verified.digest, result, verification));
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

      api.on("before_tool_call", async (event, context) => {
        const isDingTalkTool = event.toolName === RUNTIME_STATUS_TOOL_NAME
          || event.toolName === TOOL_SCHEMA_TOOL_NAME
          || event.toolName === CONTRACT_AUDIT_TOOL_NAME
          || event.toolName === EVENT_SNAPSHOT_TOOL_NAME
          || DINGTALK_TOOL_SPEC_BY_NAME.has(event.toolName);
        if (!isDingTalkTool) return;
        const authorizationFailure = agentAuthorizationFailure(allowedAgentIds, context.agentId);
        if (authorizationFailure) return { block: true, blockReason: authorizationFailure };
        const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(event.toolName);
        if (!spec || spec.effect === "read") return;
        try {
          const approval = await prepareDingTalkWriteApproval(spec, event.params, schemas);
          return {
            requireApproval: {
              title: spec.label,
              description: approval.description,
              severity: spec.risk === "high" ? "critical" : "warning",
              timeoutMs: 300_000,
              timeoutReason: "钉钉业务操作审批已超时",
              allowedDecisions: ["allow-once", "deny"],
              pluginId: PLUGIN_ID,
            },
          };
        } catch {
          return {
            block: true,
            blockReason: "钉钉写入身份、契约或参数未通过执行前核验",
          };
        }
      });
    },
  });
}

const plugin = createJunqiDingTalkPlugin();

export default plugin;
export { assertDingTalkReadResult };
export {
  CONTRACT_AUDIT_TOOL_NAME,
  DINGTALK_TOOL_SPECS,
  EVENT_SNAPSHOT_TOOL_NAME,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} from "./tool-specs.js";
export { DINGTALK_EVENT_SNAPSHOT_RPC_METHOD } from "./event-rpc.js";
