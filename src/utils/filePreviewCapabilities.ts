export type WorkspaceFilePreview =
  | {
      kind: "text";
      text: string;
      base64: null;
      mimeType: string | null;
      byteLength: number;
    }
  | {
      kind: "image";
      text: null;
      base64: string;
      mimeType: string;
      byteLength: number;
    }
  | {
      kind: "pdf";
      text: null;
      base64: string;
      mimeType: string;
      byteLength: number;
    }
  | {
      kind: "binary";
      text: null;
      base64: null;
      mimeType: null;
      byteLength: number;
    };

export type ManagedFilePreview =
  | {
      kind: "html";
      mode: "interactive";
      url: string;
    }
  | {
      kind: "html";
      mode: "static";
      content: string;
      truncated: boolean;
    }
  | {
      kind: "image" | "audio" | "video" | "pdf";
      url: string;
    }
  | {
      kind: "json" | "markdown" | "text";
      content: string;
      truncated: boolean;
    };

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown", "mdown"]);
const RICH_SOURCE_EXTENSIONS = new Set(["mmd", "mermaid", "csv", "tsv", "ipynb"]);

export function fileExtension(fileName: string): string {
  const baseName = fileName.replace(/^.*[/\\]/, "");
  const dot = baseName.lastIndexOf(".");
  return dot > 0 ? baseName.slice(dot + 1).toLowerCase() : "";
}

export function isMarkdownFile(fileName: string): boolean {
  return MARKDOWN_EXTENSIONS.has(fileExtension(fileName));
}

/** Formats Orca gives a rich view; JunQi currently opens them safely as source. */
export function isRichSourceFile(fileName: string): boolean {
  return RICH_SOURCE_EXTENSIONS.has(fileExtension(fileName));
}

export function imageDataUrl(preview: Extract<WorkspaceFilePreview, { kind: "image" }>): string {
  return `data:${preview.mimeType};base64,${preview.base64}`;
}

export function decodeWorkspaceFilePreview(value: unknown): WorkspaceFilePreview {
  if (!value || typeof value !== "object") {
    throw new TypeError("Invalid file preview response");
  }
  const candidate = value as Record<string, unknown>;
  const byteLength = candidate.byteLength;
  if (typeof byteLength !== "number" || !Number.isFinite(byteLength) || byteLength < 0) {
    throw new TypeError("Invalid file preview byte length");
  }

  switch (candidate.kind) {
    case "text":
      if (typeof candidate.text !== "string" || candidate.base64 !== null) break;
      return {
        kind: "text",
        text: candidate.text,
        base64: null,
        mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : null,
        byteLength,
      };
    case "image":
    case "pdf":
      if (
        candidate.text !== null
        || typeof candidate.base64 !== "string"
        || typeof candidate.mimeType !== "string"
      ) break;
      return {
        kind: candidate.kind,
        text: null,
        base64: candidate.base64,
        mimeType: candidate.mimeType,
        byteLength,
      };
    case "binary":
      if (candidate.text !== null || candidate.base64 !== null || candidate.mimeType !== null) break;
      return {
        kind: "binary",
        text: null,
        base64: null,
        mimeType: null,
        byteLength,
      };
  }
  throw new TypeError("Invalid file preview response");
}
