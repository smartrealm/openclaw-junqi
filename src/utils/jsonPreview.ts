import { parser as jsonParser } from "@lezer/json";

export function isJsonFileName(fileName: string): boolean {
  const baseName = fileName.replace(/^.*[/\\]/, "");
  const dot = baseName.lastIndexOf(".");
  return dot > 0 && baseName.slice(dot + 1).toLowerCase() === "json";
}

type JsonSyntaxTree = ReturnType<typeof jsonParser.parse>;
type JsonSyntaxNode = JsonSyntaxTree["topNode"];

function containsSyntaxError(tree: JsonSyntaxTree): boolean {
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) return true;
  } while (cursor.next());
  return false;
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function leafNodes(root: JsonSyntaxNode): JsonSyntaxNode[] {
  const leaves: JsonSyntaxNode[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) break;
    const children: JsonSyntaxNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      children.push(child);
    }
    if (children.length === 0) {
      leaves.push(node);
      continue;
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return leaves;
}

function formatJsonTokens(tokens: readonly JsonSyntaxNode[], content: string): string {
  let depth = 0;
  let formattingLength = 0;
  const chunks: string[] = [];
  const appendSource = (value: string) => {
    chunks.push(value);
  };
  const appendFormatting = (value: string): boolean => {
    formattingLength += value.length;
    // 格式化新增字符不超过原文长度，避免深层结构产生非线性内存膨胀。
    if (formattingLength > content.length) return false;
    chunks.push(value);
    return true;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1]?.name;
    const next = tokens[index + 1]?.name;
    if (token.name === "{" || token.name === "[") {
      appendSource(content.slice(token.from, token.to));
      const closing = token.name === "{" ? "}" : "]";
      if (next !== closing) {
        depth += 1;
        if (!appendFormatting(`\n${indent(depth)}`)) return content;
      }
      continue;
    }
    if (token.name === "}" || token.name === "]") {
      const opening = token.name === "}" ? "{" : "[";
      if (previous !== opening) {
        depth -= 1;
        if (!appendFormatting(`\n${indent(depth)}`)) return content;
      }
      appendSource(content.slice(token.from, token.to));
      continue;
    }
    if (token.name === ",") {
      appendSource(content.slice(token.from, token.to));
      if (!appendFormatting(`\n${indent(depth)}`)) return content;
      continue;
    }
    if (token.name === ":") {
      appendSource(content.slice(token.from, token.to));
      if (!appendFormatting(" ")) return content;
      continue;
    }
    appendSource(content.slice(token.from, token.to));
  }
  return chunks.join("");
}

/** 返回只读 JSON 预览；格式化过程保留字符串和数字的原始字面量。 */
export function formatJsonPreview(content: string): string | null {
  const tree = jsonParser.parse(content);
  if (containsSyntaxError(tree)) {
    try {
      // 标准解析器只用于确认语法；成功时返回原文，绝不重新序列化数值。
      JSON.parse(content);
      return content;
    } catch {
      return null;
    }
  }
  return formatJsonTokens(leafNodes(tree.topNode), content);
}
