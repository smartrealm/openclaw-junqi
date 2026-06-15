// ═══════════════════════════════════════════════════════════
// Slash commands — aligned with openclaw gateway commands.
//
// Categories group commands in the inline picker UI.
// Icons are Lucide icon names resolved at render time.
// argChoices: static completion values (from openclaw commands-registry.shared.ts).
//   Dynamic completions (e.g. /model pulls from availableModels) are handled
//   in MessageInput.tsx.
// ==========================================================

export type SlashCategory = 'session' | 'options' | 'status' | 'management' | 'tools';

export interface SlashCommand {
  cmd: string;
  label: string;
  description: string;
  category: SlashCategory;
  icon: string;
  argHint?: string;
  /** Static argument completion values — shown in second-level picker. */
  argChoices?: string[];
  local?: boolean;
  localAction?: 'clear' | 'new' | 'compress';
}

// ── Category metadata ──

export const CATEGORY_META: Record<SlashCategory, { label: string; icon: string }> = {
  session:    { label: '会话', icon: 'MessageCircle' },
  options:    { label: '选项', icon: 'Settings' },
  status:     { label: '状态', icon: 'BarChart3' },
  management: { label: '管理', icon: 'Shield' },
  tools:      { label: '工具', icon: 'Wrench' },
};

// ── All built-in commands (aligned with openclaw buildBuiltinChatCommands) ──

export const SLASH_COMMANDS: SlashCommand[] = [
  // ═══ 会话 ═══
  { cmd: '/clear',    label: '/clear',    description: '清除当前会话上下文 (本地)',
    category: 'session', icon: 'Eraser', local: true, localAction: 'clear' },
  { cmd: '/compact',  label: '/compact',  description: '压缩会话上下文',
    category: 'session', icon: 'Shrink' },
  { cmd: '/new',      label: '/new',      description: '新建空白会话 (本地)',
    category: 'session', icon: 'Plus', local: true, localAction: 'new' },
  { cmd: '/reset',    label: '/reset',    description: '重置当前会话',
    category: 'session', icon: 'RotateCcw' },
  { cmd: '/stop',     label: '/stop',     description: '停止当前 AI 回复',
    category: 'session', icon: 'Square' },
  { cmd: '/restart',  label: '/restart',  description: '重启 OpenClaw',
    category: 'session', icon: 'Power' },

  // ═══ 选项 (有参数补全) ═══
  { cmd: '/model',    label: '/model',    description: '查看或切换模型',
    category: 'options', icon: 'Cpu', argHint: '<model-id>' },
  { cmd: '/models',   label: '/models',   description: '列出可用模型/提供商',
    category: 'options', icon: 'Cpu' },
  { cmd: '/think',    label: '/think',    description: '设置思考级别',
    category: 'options', icon: 'Brain', argHint: '<level>',
    argChoices: ['auto', 'high', 'medium', 'low', 'minimal', 'off', 'xhigh', 'adaptive', 'max'] },
  { cmd: '/fast',     label: '/fast',     description: '设置快速模式',
    category: 'options', icon: 'Zap', argHint: '<mode>',
    argChoices: ['status', 'on', 'off', 'default'] },
  { cmd: '/verbose',  label: '/verbose',  description: '切换详细模式',
    category: 'options', icon: 'MessageCircle', argHint: '<mode>',
    argChoices: ['on', 'off', 'full'] },
  { cmd: '/trace',    label: '/trace',    description: '切换插件跟踪行',
    category: 'options', icon: 'Eye', argHint: '<mode>',
    argChoices: ['on', 'off', 'raw'] },
  { cmd: '/reasoning',label: '/reasoning',description: '切换推理可见性',
    category: 'options', icon: 'Lightbulb', argHint: '<mode>',
    argChoices: ['on', 'off', 'stream'] },
  { cmd: '/elevated', label: '/elevated', description: '切换提升模式',
    category: 'options', icon: 'Shield', argHint: '<mode>',
    argChoices: ['on', 'off', 'ask', 'full'] },
  { cmd: '/elev',     label: '/elev',     description: '/elevated 别名',
    category: 'options', icon: 'Shield', argHint: '<mode>',
    argChoices: ['on', 'off', 'ask', 'full'] },
  { cmd: '/usage',    label: '/usage',    description: '设置用量页脚模式',
    category: 'options', icon: 'BarChart3', argHint: '<mode>',
    argChoices: ['off', 'tokens', 'full', 'cost'] },
  { cmd: '/activation',label: '/activation',description: '设置群组激活模式',
    category: 'options', icon: 'Bell', argHint: '<mode>',
    argChoices: ['mention', 'always'] },
  { cmd: '/send',     label: '/send',     description: '设置发送策略',
    category: 'options', icon: 'Send', argHint: '<mode>',
    argChoices: ['on', 'off', 'inherit'] },

  // ═══ 状态 ═══
  { cmd: '/help',     label: '/help',     description: '显示可用命令',
    category: 'status', icon: 'HelpCircle' },
  { cmd: '/commands', label: '/commands', description: '列出所有斜杠命令',
    category: 'status', icon: 'List' },
  { cmd: '/status',   label: '/status',   description: '显示当前状态',
    category: 'status', icon: 'Activity' },
  { cmd: '/whoami',   label: '/whoami',   description: '显示发送者 ID',
    category: 'status', icon: 'User' },
  { cmd: '/tasks',    label: '/tasks',    description: '列出后台任务',
    category: 'status', icon: 'ListTodo' },
  { cmd: '/tools',    label: '/tools',    description: '列出运行时工具',
    category: 'status', icon: 'Wrench', argHint: '<mode>',
    argChoices: ['compact', 'verbose'] },
  { cmd: '/context',  label: '/context',  description: '显示上下文构建信息',
    category: 'status', icon: 'FileText' },
  { cmd: '/export',   label: '/export',   description: '导出会话到 HTML',
    category: 'status', icon: 'Download' },

  // ═══ 管理 (有子命令) ═══
  { cmd: '/goal',     label: '/goal',     description: '查看/控制当前目标',
    category: 'management', icon: 'Target', argHint: '<action>',
    argChoices: ['status', 'start', 'pause', 'resume', 'complete', 'block', 'clear'] },
  { cmd: '/session',  label: '/session',  description: '管理会话设置',
    category: 'management', icon: 'Settings', argHint: '<action>',
    argChoices: ['idle', 'max-age'] },
  { cmd: '/subagents',label: '/subagents',description: '检查子代理运行',
    category: 'management', icon: 'Bot', argHint: '<action>',
    argChoices: ['list', 'log', 'info'] },
  { cmd: '/focus',    label: '/focus',    description: '绑定当前频道到会话',
    category: 'management', icon: 'Crosshair' },
  { cmd: '/unfocus',  label: '/unfocus',  description: '移除当前频道绑定',
    category: 'management', icon: 'Minimize2' },
  { cmd: '/agents',   label: '/agents',   description: '列出绑定代理',
    category: 'management', icon: 'Users' },
  { cmd: '/steer',    label: '/steer',    description: '向活跃运行发送指引',
    category: 'management', icon: 'Navigation' },
  { cmd: '/config',   label: '/config',   description: '查看/设置配置值',
    category: 'management', icon: 'FileCode', argHint: '<action>',
    argChoices: ['show', 'get', 'set', 'unset'] },
  { cmd: '/mcp',      label: '/mcp',      description: '管理 MCP 服务器',
    category: 'management', icon: 'Server', argHint: '<action>',
    argChoices: ['show', 'get', 'set', 'unset'] },
  { cmd: '/plugins',  label: '/plugins',  description: '管理插件',
    category: 'management', icon: 'Package', argHint: '<action>',
    argChoices: ['list', 'show', 'get', 'enable', 'disable'] },
  { cmd: '/debug',    label: '/debug',    description: '设置运行时调试覆盖',
    category: 'management', icon: 'Bug', argHint: '<action>',
    argChoices: ['show', 'reset', 'set', 'unset'] },
  { cmd: '/exec',     label: '/exec',     description: '设置 exec 默认值',
    category: 'management', icon: 'Terminal', argHint: '<host>',
    argChoices: ['sandbox', 'gateway', 'node'] },

  // ═══ 工具 ═══
  { cmd: '/skill:',   label: '/skill:<name>', description: '按名称运行技能',
    category: 'tools', icon: 'Sparkles', argHint: '<name>' },
  { cmd: '/btw',      label: '/btw',      description: '旁路提问（不影响会话）',
    category: 'tools', icon: 'MessageSquare' },
  { cmd: '/side',     label: '/side',     description: '/btw 别名',
    category: 'tools', icon: 'MessageSquare' },
  { cmd: '/tts',      label: '/tts',      description: '控制文本转语音',
    category: 'tools', icon: 'Volume2', argHint: '<action>',
    argChoices: ['on', 'off', 'status', 'provider', 'limit', 'summary', 'audio', 'help'] },
  { cmd: '/acp',      label: '/acp',      description: '管理 ACP 会话和选项',
    category: 'tools', icon: 'Cog', argHint: '<action>',
    argChoices: ['spawn', 'cancel', 'steer', 'close', 'sessions', 'status', 'set-mode', 'set', 'cwd', 'permissions', 'timeout', 'model', 'reset-options', 'doctor', 'install', 'help'] },
];
