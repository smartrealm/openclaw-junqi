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

function mergeAgentToolPolicy(agent: Record<string, unknown>, agentId: string): Record<string, unknown> {
  const tools = record(agent.tools) ?? {};
  const allow = stringList(tools.allow, 'OpenClaw 当前 Agent 的 tools.allow');
  const alsoAllow = stringList(tools.alsoAllow, 'OpenClaw 当前 Agent 的 tools.alsoAllow');
  const deny = stringList(tools.deny, 'OpenClaw 当前 Agent 的 tools.deny') ?? [];
  if (deny.some(deniesDingTalk)) {
    throw new Error(`当前 Agent ${agentId} 明确拒绝了钉钉插件，请先移除该拒绝规则。`);
  }

  if (
    allow?.length === 0
    || hasEntry(allow ?? [], DINGTALK_PLUGIN_ID)
    || hasEntry(alsoAllow ?? [], DINGTALK_PLUGIN_ID)
  ) {
    return agent;
  }

  const nextTools: Record<string, unknown> = { ...tools };
  if (allow) {
    nextTools.allow = [...allow, DINGTALK_PLUGIN_ID];
  } else {
    nextTools.alsoAllow = [...(alsoAllow ?? []), DINGTALK_PLUGIN_ID];
  }
  return { ...agent, tools: nextTools };
}

function buildAgentPatch(config: Record<string, unknown>, agentId: string): Record<string, unknown> {
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
    const next = mergeAgentToolPolicy(current, agentId);
    return next === current ? {} : { agents: { entries: { [agentId]: { tools: next.tools } } } };
  }

  if (Array.isArray(agents.list)) {
    const current = agents.list.find((entry) => record(entry)?.id === agentId);
    if (!current) {
      throw new Error(`当前 Agent ${agentId} 没有显式配置，JunQi 不会替你创建新的 Agent。`);
    }
    const currentRecord = record(current);
    if (!currentRecord) throw new Error('OpenClaw 当前 Agent 配置无效。');
    const next = mergeAgentToolPolicy(currentRecord, agentId);
    return next === currentRecord ? {} : { agents: { list: [{ id: agentId, tools: next.tools }] } };
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
  const agentPatch = buildAgentPatch(config, normalizedAgentId);
  const pluginPatch = buildPluginPatch(config, normalizedAgentId);
  const patch = mergePatch(agentPatch, pluginPatch);
  if (Object.keys(patch).length === 0) return;

  const response = await gateway.callPrivileged('config.patch', {
    raw: JSON.stringify(patch),
    ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
  });
  const acknowledgement = record(response);
  if (!acknowledgement || acknowledgement.ok !== true) {
    throw new Error('OpenClaw 没有确认授权配置已写入。');
  }
}
