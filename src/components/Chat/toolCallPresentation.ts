/**
 * User-facing labels for built-in Gateway tools. Unknown upstream tools keep
 * their reported name because JunQi has no reliable localized alias for them.
 */
export const TOOL_LABEL_KEYS = {
  web_search: 'chat.tools.webSearch',
  web_fetch: 'chat.tools.webFetch',
  browser: 'chat.tools.browser',
  Read: 'chat.tools.readFile',
  Write: 'chat.tools.writeFile',
  Edit: 'chat.tools.editFile',
  exec: 'chat.tools.execute',
  process: 'chat.tools.process',
  memory_search: 'chat.tools.memorySearch',
  memory_get: 'chat.tools.memoryGet',
  sessions_spawn: 'chat.tools.spawnAgent',
  sessions_send: 'chat.tools.sendMessage',
  session_status: 'chat.tools.status',
  cron: 'chat.tools.cron',
  image: 'chat.tools.image',
  tts: 'chat.tools.textToSpeech',
  gateway: 'chat.tools.gateway',
  message: 'chat.tools.message',
} as const;

export type BuiltInToolName = keyof typeof TOOL_LABEL_KEYS;
export type ToolLabelKey = (typeof TOOL_LABEL_KEYS)[BuiltInToolName];

export function getToolLabelKey(toolName: string): ToolLabelKey | undefined {
  return TOOL_LABEL_KEYS[toolName as BuiltInToolName];
}
