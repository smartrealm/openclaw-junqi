import type { Extension } from "@codemirror/state";

type LegacyMode =
  | "shell"
  | "toml"
  | "dockerfile"
  | "ruby"
  | "lua"
  | "swift"
  | "kotlin"
  | "csharp"
  | "r";

async function legacy(mode: LegacyMode): Promise<Extension> {
  const { StreamLanguage } = await import("@codemirror/language");
  switch (mode) {
    case "shell": {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      return StreamLanguage.define(shell);
    }
    case "toml": {
      const { toml } = await import("@codemirror/legacy-modes/mode/toml");
      return StreamLanguage.define(toml);
    }
    case "dockerfile": {
      const { dockerFile } = await import("@codemirror/legacy-modes/mode/dockerfile");
      return StreamLanguage.define(dockerFile);
    }
    case "ruby": {
      const { ruby } = await import("@codemirror/legacy-modes/mode/ruby");
      return StreamLanguage.define(ruby);
    }
    case "lua": {
      const { lua } = await import("@codemirror/legacy-modes/mode/lua");
      return StreamLanguage.define(lua);
    }
    case "swift": {
      const { swift } = await import("@codemirror/legacy-modes/mode/swift");
      return StreamLanguage.define(swift);
    }
    case "kotlin": {
      const { kotlin } = await import("@codemirror/legacy-modes/mode/clike");
      return StreamLanguage.define(kotlin);
    }
    case "csharp": {
      const { csharp } = await import("@codemirror/legacy-modes/mode/clike");
      return StreamLanguage.define(csharp);
    }
    case "r": {
      const { r } = await import("@codemirror/legacy-modes/mode/r");
      return StreamLanguage.define(r);
    }
  }
}

export async function loadCodeMirrorLanguage(fileNameOrExt: string | null | undefined): Promise<Extension> {
  const raw = (fileNameOrExt || "").toLowerCase().trim();
  const lower = raw.replace(/^.*[/\\]/, "");

  switch (lower) {
    case "dockerfile":
    case "dockerfile.dev":
    case "dockerfile.prod":
      return legacy("dockerfile");
    case "makefile":
    case "gnumakefile":
    case "bsdmakefile":
    case "makefile.in":
    case "justfile":
    case "procfile":
    case "cmakelists.txt":
    case ".gitignore":
    case ".dockerignore":
    case ".env":
    case ".env.local":
    case ".env.example":
      return legacy("shell");
    case "gemfile":
    case "rakefile":
    case "vagrantfile":
      return legacy("ruby");
    case ".npmrc":
      return legacy("toml");
    case ".yarnrc": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return yaml();
    }
    case "changelog.md":
    case "readme": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
  }

  const ext = lower.includes(".") ? lower.split(".").pop() || "" : lower;
  switch (ext) {
    case "ts": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true });
    }
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: true, typescript: true });
    }
    case "js":
    case "mjs":
    case "cjs": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript();
    }
    case "jsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: true });
    }
    case "json":
    case "jsonc": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "rs": {
      const { rust } = await import("@codemirror/lang-rust");
      return rust();
    }
    case "html":
    case "htm":
    case "vue":
    case "svelte": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "css":
    case "scss":
    case "sass":
    case "less": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "md":
    case "mdx":
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
    case "yaml":
    case "yml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return yaml();
    }
    case "toml":
      return legacy("toml");
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "proto":
    case "mk":
    case "make":
      return legacy("shell");
    case "py": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "go": {
      const { go } = await import("@codemirror/lang-go");
      return go();
    }
    case "java": {
      const { java } = await import("@codemirror/lang-java");
      return java();
    }
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "hpp":
    case "cxx": {
      const { cpp } = await import("@codemirror/lang-cpp");
      return cpp();
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql");
      return sql();
    }
    case "xml":
    case "svg": {
      const { xml } = await import("@codemirror/lang-xml");
      return xml();
    }
    case "swift":
      return legacy("swift");
    case "kt":
      return legacy("kotlin");
    case "cs":
    case "csx":
      return legacy("csharp");
    case "rb":
      return legacy("ruby");
    case "lua":
      return legacy("lua");
    case "r":
      return legacy("r");
    default:
      return [];
  }
}
