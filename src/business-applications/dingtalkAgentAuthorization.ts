import { readOpenClawConfigSnapshot } from '@/services/gateway/OpenClawConfigSnapshot';

export const DINGTALK_PLUGIN_ID = 'junqi-dingtalk';
const DINGTALK_TOOL_PREFIX = 'junqi_dingtalk_';

interface ConfigGateway {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  callPrivileged(method: string, params: Record<string, unknown>): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown, label: string): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label}不是有效列表。`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function deniesDingTalk(entry: string): boolean {
  return entry === '*'
    || entry === DINGTALK_PLUGIN_ID
    || entry === 'group:plugins'
    || entry.startsWith(DINGTALK_TOOL_PREFIX);
}

function hasEntry(list: readonly string[], entry: string): boolean {
  return list.some((value) => value === entry || value === '*' || value === 'group:plugins');
}

function buildObjectPatch(current: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    if (!(key in next)) {
      patch[key] = null;
      continue;
    }
    if (!(key in current) || JSON.stringify(current[key]) !== JSON.stringify(next[key])) {
      patch[key] = next[key];
    }
  }
  return patch;
}

function mergeDingTalkToolPolicy(tools: Record<string, unknown>, label: string): Record<string, unknown> {
  const allow = stringList(tools.allow, `${label}的 tools.allow`);
  const alsoAllow = stringList(tools.alsoAllow, `${label}的 tools.alsoAllow`);
  const deny = stringList(tools.deny, `${label}的 tools.deny`) ?? [];
  if (deny.some(deniesDingTalk)) {
    throw new Error(`${label}明确拒绝了钉钉插件，请先移除该拒绝规则。`);
  }
  if (hasEntry(allow ?? [], DINGTALK_PLUGIN_ID) || hasEntry(alsoAllow ?? [], DINGTALK_PLUGIN_ID)) {
    return tools;
  }

  const nextTools: Record<string, unknown> = { ...tools };
  if (allow && allow.length === 0) {
    delete nextTools.allow;
    nextTools.alsoAllow = [DINGTALK_PLUGIN_ID];
    return nextTools;
  }
  if (allow) {
    nextTools.allow = [...allow, DINGTALK_PLUGIN_ID];
  } else {
    nextTools.alsoAllow = [...(alsoAllow ?? []), DINGTALK_PLUGIN_ID];
  }
  return nextTools;
}

function sandboxModeForAgent(config: Record<string, unknown>, agent: Record<string, unknown>): 'off' | 'non-main' | 'all' {
  const defaults = record(record(config.agents)?.defaults);
  const configuredMode = record(agent.sandbox)?.mode ?? record(defaults?.sandbox)?.mode;
  if (configuredMode === undefined || configuredMode === 'off') return 'off';
  if (configuredMode === 'non-main' || configuredMode === 'all') return configuredMode;
  throw new Error('当前 Agent 的 sandbox.mode 未被 OpenClaw 配置快照确认。');
}

function sandboxToolPolicyApplies(
  config: Record<string, unknown>,
  agent: Record<string, unknown>,
  sessionKey: string | null | undefined,
): boolean {
  const mode = sandboxModeForAgent(config, agent);
  if (mode === 'all') return true;
  if (mode === 'off') return false;
  const normalizedSessionKey = sessionKey?.trim() ?? '';
  return Boolean(normalizedSessionKey && !/^agent:[^:]+:main$/i.test(normalizedSessionKey));
}

function mergeDingTalkSandboxToolPolicy(tools: Record<string, unknown>, label: string): Record<string, unknown> {
  const allow = stringList(tools.allow, `${label}的 tools.allow`);
  const alsoAllow = stringList(tools.alsoAllow, `${label}的 tools.alsoAllow`);
  const deny = stringList(tools.deny, `${label}的 tools.deny`) ?? [];
  if (deny.some(deniesDingTalk)) {
    throw new Error(`${label}明确拒绝了钉钉插件，请先移除该拒绝规则。`);
  }
  if (
    allow?.length === 0
    || hasEntry(allow ?? [], DINGTALK_PLUGIN_ID)
    || hasEntry(alsoAllow ?? [], DINGTALK_PLUGIN_ID)
  ) {
    return tools;
  }
  if (allow) {
    return { ...tools, allow: [...allow, DINGTALK_PLUGIN_ID] };
  }
  return { ...tools, alsoAllow: [...(alsoAllow ?? []), DINGTALK_PLUGIN_ID] };
}

function assertGlobalSandboxDoesNotDenyDingTalk(config: Record<string, unknown>): void {
  const sandbox = record(record(config.tools)?.sandbox);
  const sandboxTools = record(sandbox?.tools) ?? {};
  const deny = stringList(sandboxTools.deny, 'OpenClaw 全局 sandbox tools.deny') ?? [];
  if (deny.some(deniesDingTalk)) {
    throw new Error('OpenClaw 全局 sandbox 工具策略明确拒绝了钉钉插件，请先移除该拒绝规则。');
  }
}

function mergeAgentToolPolicy(
  config: Record<string, unknown>,
  agent: Record<string, unknown>,
  agentId: string,
  sessionKey: string | null | undefined,
): Record<string, unknown> {
  const tools = record(agent.tools) ?? {};
  const nextTools = mergeDingTalkToolPolicy(tools, `当前 Agent ${agentId}`);
  if (!sandboxToolPolicyApplies(config, agent, sessionKey)) {
    return nextTools === tools ? agent : { ...agent, tools: nextTools };
  }
  assertGlobalSandboxDoesNotDenyDingTalk(config);
  const sandbox = record(nextTools.sandbox) ?? {};
  const sandboxTools = record(sandbox.tools) ?? {};
  const nextSandboxTools = mergeDingTalkSandboxToolPolicy(
    sandboxTools,
    `当前 Agent ${agentId} 的 sandbox 工具策略`,
  );
  if (nextTools === tools && nextSandboxTools === sandboxTools) return agent;
  return {
    ...agent,
    tools: {
      ...nextTools,
      sandbox: {
        ...sandbox,
        tools: nextSandboxTools,
      },
    },
  };
}

function buildGlobalToolPatch(config: Record<string, unknown>): Record<string, unknown> {
  const tools = record(config.tools) ?? {};
  const nextTools = mergeDingTalkToolPolicy(tools, 'OpenClaw 全局工具策略');
  return nextTools === tools ? {} : { tools: buildObjectPatch(tools, nextTools) };
}

function buildAgentPatch(
  config: Record<string, unknown>,
  agentId: string,
  sessionKey: string | null | undefined,
): Record<string, unknown> {
  const agents = record(config.agents);
  if (!agents) {
    throw new Error('当前 Gateway 没有可写的显式 Agent 配置，请先在 Agent Hub 创建或配置该 Agent。');
  }

  const entries = record(agents.entries);
  if (entries) {
    const current = record(entries[agentId]);
    if (!current) {
      throw new Error(`当前 Agent ${agentId} 没有显式配置，JunQi 不会替你创建新的 Agent。`);
    }
    const next = mergeAgentToolPolicy(config, current, agentId, sessionKey);
    if (next === current) return {};
    return {
      agents: {
        entries: {
          [agentId]: { tools: buildObjectPatch(record(current.tools) ?? {}, record(next.tools) ?? {}) },
        },
      },
    };
  }

  if (Array.isArray(agents.list)) {
    const current = agents.list.find((entry) => record(entry)?.id === agentId);
    if (!current) {
      throw new Error(`当前 Agent ${agentId} 没有显式配置，JunQi 不会替你创建新的 Agent。`);
    }
    const currentRecord = record(current);
    if (!currentRecord) throw new Error('OpenClaw 当前 Agent 配置无效。');
    const next = mergeAgentToolPolicy(config, currentRecord, agentId, sessionKey);
    return next === currentRecord
      ? {}
      : {
          agents: {
            list: [{
              id: agentId,
              tools: buildObjectPatch(record(currentRecord.tools) ?? {}, record(next.tools) ?? {}),
            }],
          },
        };
  }

  throw new Error('当前 Gateway 的 Agent 配置结构未被官方快照确认，暂不能自动授权。');
}

function buildPluginPatch(config: Record<string, unknown>, agentId: string): Record<string, unknown> {
  const plugins = record(config.plugins) ?? {};
  const entries = record(plugins.entries) ?? {};
  const plugin = record(entries[DINGTALK_PLUGIN_ID]) ?? {};
  const pluginConfig = record(plugin.config) ?? {};
  const allowed = stringList(
    pluginConfig.allowedAgentIds,
    '钉钉插件的 allowedAgentIds',
  ) ?? [];
  if (allowed.includes(agentId)) return {};
  return {
    plugins: {
      entries: {
        [DINGTALK_PLUGIN_ID]: {
          config: { allowedAgentIds: [...allowed, agentId] },
        },
      },
    },
  };
}

function agentTools(config: Record<string, unknown>, agentId: string): Record<string, unknown> {
  const agents = record(config.agents);
  const entries = record(agents?.entries);
  const entry = entries ? record(entries[agentId]) : null;
  if (entry) return record(entry.tools) ?? {};
  const list = Array.isArray(agents?.list) ? agents.list : null;
  const item = list?.find((candidate) => record(candidate)?.id === agentId);
  return record(record(item)?.tools) ?? {};
}

function agentConfig(config: Record<string, unknown>, agentId: string): Record<string, unknown> | null {
  const agents = record(config.agents);
  const entries = record(agents?.entries);
  const entry = entries ? record(entries[agentId]) : null;
  if (entry) return entry;
  const list = Array.isArray(agents?.list) ? agents.list : null;
  const item = list?.find((candidate) => record(candidate)?.id === agentId);
  return record(item);
}

function policyAllowsDingTalk(tools: Record<string, unknown>, label: string): boolean {
  const allow = stringList(tools.allow, `${label}的 tools.allow`) ?? [];
  const alsoAllow = stringList(tools.alsoAllow, `${label}的 tools.alsoAllow`) ?? [];
  const deny = stringList(tools.deny, `${label}的 tools.deny`) ?? [];
  return !deny.some(deniesDingTalk) && (
    hasEntry(allow, DINGTALK_PLUGIN_ID) || hasEntry(alsoAllow, DINGTALK_PLUGIN_ID)
  );
}

function sandboxPolicyAllowsDingTalk(tools: Record<string, unknown>, label: string): boolean {
  const allow = stringList(tools.allow, `${label}的 tools.allow`);
  const alsoAllow = stringList(tools.alsoAllow, `${label}的 tools.alsoAllow`) ?? [];
  const deny = stringList(tools.deny, `${label}的 tools.deny`) ?? [];
  return !deny.some(deniesDingTalk) && (
    allow?.length === 0
    || hasEntry(allow ?? [], DINGTALK_PLUGIN_ID)
    || hasEntry(alsoAllow, DINGTALK_PLUGIN_ID)
  );
}

function assertDingTalkAuthorizationPersisted(
  config: Record<string, unknown>,
  agentId: string,
  sessionKey: string | null | undefined,
): void {
  if (!policyAllowsDingTalk(record(config.tools) ?? {}, 'OpenClaw 全局工具策略')) {
    throw new Error('OpenClaw 没有确认全局工具策略已允许钉钉插件。');
  }
  if (!policyAllowsDingTalk(agentTools(config, agentId), `当前 Agent ${agentId}`)) {
    throw new Error(`OpenClaw 没有确认当前 Agent ${agentId} 的工具策略已允许钉钉插件。`);
  }
  const agent = agentConfig(config, agentId);
  if (!agent) throw new Error(`OpenClaw 没有确认当前 Agent ${agentId} 的配置。`);
  if (sandboxToolPolicyApplies(config, agent, sessionKey)) {
    assertGlobalSandboxDoesNotDenyDingTalk(config);
    const sandbox = record(agentTools(config, agentId).sandbox) ?? {};
    const sandboxTools = record(sandbox.tools) ?? {};
    if (!sandboxPolicyAllowsDingTalk(sandboxTools, `当前 Agent ${agentId} 的 sandbox 工具策略`)) {
      throw new Error(`OpenClaw 没有确认当前 Agent ${agentId} 的 sandbox 工具策略已允许钉钉插件。`);
    }
  }
  const plugins = record(config.plugins);
  const entries = record(plugins?.entries);
  const plugin = record(entries?.[DINGTALK_PLUGIN_ID]);
  const pluginConfig = record(plugin?.config);
  const allowed = stringList(pluginConfig?.allowedAgentIds, '钉钉插件的 allowedAgentIds') ?? [];
  if (!allowed.includes(agentId)) {
    throw new Error(`OpenClaw 没有确认钉钉插件已授权当前 Agent ${agentId}。`);
  }
}

function mergePatch(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = record(result[key]);
    const next = record(value);
    result[key] = existing && next ? mergePatch(existing, next) : value;
  }
  return result;
}

export async function authorizeDingTalkAgent(
  gateway: ConfigGateway,
  agentId: string,
  sessionKey: string | null | undefined = null,
): Promise<void> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error('当前 Session 没有可核验的 Agent ID。');
  const snapshot = readOpenClawConfigSnapshot(await gateway.call('config.get', {}));
  const config = snapshot.config as unknown as Record<string, unknown>;
  const globalDeny = stringList(
    record(config.tools)?.deny,
    'OpenClaw 全局 tools.deny',
  ) ?? [];
  if (globalDeny.some(deniesDingTalk)) {
    throw new Error('OpenClaw 全局工具策略明确拒绝了钉钉插件，请先移除该拒绝规则。');
  }
  const globalPatch = buildGlobalToolPatch(config);
  const agentPatch = buildAgentPatch(config, normalizedAgentId, sessionKey);
  const pluginPatch = buildPluginPatch(config, normalizedAgentId);
  const patch = mergePatch(mergePatch(globalPatch, agentPatch), pluginPatch);
  if (Object.keys(patch).length === 0) {
    assertDingTalkAuthorizationPersisted(config, normalizedAgentId, sessionKey);
    return;
  }

  const response = await gateway.callPrivileged('config.patch', {
    raw: JSON.stringify(patch),
    ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
  });
  const acknowledgement = record(response);
  if (!acknowledgement || acknowledgement.ok !== true) {
    throw new Error('OpenClaw 没有确认授权配置已写入。');
  }
  const confirmed = readOpenClawConfigSnapshot(await gateway.call('config.get', {}));
  assertDingTalkAuthorizationPersisted(
    confirmed.config as unknown as Record<string, unknown>,
    normalizedAgentId,
    sessionKey,
  );
}

export async function configureDingTalkDwsPath(
  gateway: ConfigGateway,
  dwsPath: string,
): Promise<void> {
  const normalizedPath = dwsPath.trim();
  if (!normalizedPath) throw new Error('当前运行时没有返回可核验的 DWS 路径。');
  const snapshot = readOpenClawConfigSnapshot(await gateway.call('config.get', {}));
  const config = snapshot.config as unknown as Record<string, unknown>;
  const plugins = record(config.plugins) ?? {};
  const entries = record(plugins.entries) ?? {};
  const plugin = record(entries[DINGTALK_PLUGIN_ID]) ?? {};
  const pluginConfig = record(plugin.config) ?? {};
  if (pluginConfig.dwsPath === normalizedPath) return;

  const response = await gateway.callPrivileged('config.patch', {
    raw: JSON.stringify({
      plugins: {
        entries: {
          [DINGTALK_PLUGIN_ID]: { config: { dwsPath: normalizedPath } },
        },
      },
    }),
    ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
  });
  const acknowledgement = record(response);
  if (!acknowledgement || acknowledgement.ok !== true) {
    throw new Error('OpenClaw 没有确认 DWS 运行时路径已写入。');
  }
}
