import { formatJsonPreview } from './jsonPreview';

function jsonDocument(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return null;
  return formatJsonPreview(trimmed);
}

function markdownFence(value: string): string {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/** 完整 JSON 文档使用保留字面量的缩进展示，无法确认时原样返回。 */
export function formatStructuredTranscriptText(value: string): string {
  return jsonDocument(value) ?? value;
}

/** assistant 的完整 JSON 文档投影为代码块，既有 Markdown 围栏保持不变。 */
export function formatAssistantTranscriptMarkdown(value: string): string | null {
  if (value.includes('```') || value.includes('~~~')) return null;
  const formatted = jsonDocument(value);
  if (formatted === null) return null;
  const fence = markdownFence(formatted);
  return `${fence}json\n${formatted}\n${fence}`;
}
