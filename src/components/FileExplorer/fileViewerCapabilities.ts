import { readDir } from "@/services/workspaceFs";
import { resolveWorkspacePreview } from "@/workspace-files/services/previewResolver";
import { parentPathOf } from "./treeUtils";

const PREVIEW_CAPABILITIES = {
  read: true,
  write: true,
  nativePreview: true,
} as const;

const MAX_MAKE_TARGETS = 32;

export function resolveFileViewerPreview(fileName: string) {
  return resolveWorkspacePreview({
    path: fileName,
    policy: "workspace",
    capabilities: PREVIEW_CAPABILITIES,
  });
}

export function usesEditableDocument(fileName: string): boolean {
  const mode = resolveFileViewerPreview(fileName).mode;
  return mode === "editor"
    || mode === "json"
    || mode === "markdown"
    || mode === "static-html"
    || mode === "isolated-html";
}

export function isMakefile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (["makefile", "gnumakefile", "bsdmakefile", "makefile.in"].includes(lower)) {
    return true;
  }
  const extension = lower.split(".").pop();
  return extension === "mk" || extension === "make";
}

export function parseMakeTargets(content: string): string[] {
  const targets: string[] = [];
  const targetPattern = /^([A-Za-z0-9_./-]+(?:\s+[A-Za-z0-9_./-]+)*)\s*:(?!=)/;

  for (const rawLine of content.split(/\r?\n/)) {
    if (targets.length >= MAX_MAKE_TARGETS) break;
    const line = rawLine.replace(/\\\r?\n$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.startsWith("\t") || line.startsWith("    ")) continue;
    if (/^\.[A-Z][A-Z0-9_]*\s*[:?]?=/.test(line.trim())) continue;
    if (line.includes("=") && !line.includes(":")) continue;

    const match = line.match(targetPattern);
    if (!match) continue;
    for (const target of match[1].trim().split(/\s+/)) {
      if (!target || target.startsWith(".") || target === "$" || targets.includes(target)) continue;
      targets.push(target);
      if (targets.length >= MAX_MAKE_TARGETS) break;
    }
  }
  return targets;
}

export function fileTabColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "#0db7ed";
  if (["makefile", "gnumakefile", "justfile"].includes(lower)) return "#bf7a00";
  if (lower.startsWith(".git") || lower.startsWith(".docker") || lower === ".editorconfig" || lower === ".npmrc") return "#8b949e";
  if (lower === ".env" || lower.startsWith(".env.")) return "#8b949e";

  const extension = lower.includes(".") ? lower.split(".").pop() : "";
  if (["ts", "tsx"].includes(extension ?? "")) return "#3178c6";
  if (["js", "jsx", "mjs", "cjs", "json", "jsonc"].includes(extension ?? "")) return "#f0db4f";
  if (extension === "rs") return "#dea584";
  if (extension === "py") return "#3572a5";
  if (extension === "go") return "#00add8";
  if (["html", "htm"].includes(extension ?? "")) return "#e34c26";
  if (["css", "scss", "sass"].includes(extension ?? "")) return "#563d7c";
  if (["md", "mdx"].includes(extension ?? "")) return "#083fa1";
  if (["yaml", "yml"].includes(extension ?? "")) return "#cb171e";
  if (extension === "toml") return "#9c4221";
  if (["sh", "bash"].includes(extension ?? "")) return "#89e051";
  return "var(--aegis-text-dim)";
}

export async function fileIsGone(
  filePath: string,
  fileName: string,
  projectPath: string,
): Promise<boolean> {
  const directory = parentPathOf(filePath);
  if (!directory) return false;
  try {
    const entries = await readDir(directory, projectPath);
    return !entries.some((entry) => !entry.is_dir && entry.name === fileName);
  } catch {
    return true;
  }
}
