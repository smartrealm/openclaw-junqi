import {
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toString } from "mdast-util-to-string";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import {
  decodeWorkspaceFilePreview,
  imageDataUrl,
} from "@/utils/filePreviewCapabilities";
import { resolveMarkdownResourcePath } from "./fileViewerModel";

export type MarkdownHeading = {
  depth: number;
  id: string;
  text: string;
};

type ParsedMarkdownHeading = MarkdownHeading & {
  line: number;
};

function headingSlug(text: string): string {
  const slug = text
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug || "section";
}

function parseMarkdownHeadings(content: string): ParsedMarkdownHeading[] {
  const headings: ParsedMarkdownHeading[] = [];
  const slugCounts = new Map<string, number>();

  const addHeading = (depth: number, text: string, line: number) => {
    const baseId = headingSlug(text);
    const duplicateIndex = slugCounts.get(baseId) ?? 0;
    slugCounts.set(baseId, duplicateIndex + 1);
    headings.push({
      depth,
      id: duplicateIndex === 0 ? baseId : `${baseId}-${duplicateIndex}`,
      text,
      line,
    });
  };

  const tree = unified().use(remarkParse).parse(content);
  visit(tree, "heading", (node) => {
    const line = node.position?.start.line;
    if (line) addHeading(node.depth, toString(node), line);
  });
  return headings;
}

export function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  return parseMarkdownHeadings(content).map(({ depth, id, text }) => ({ depth, id, text }));
}

function LocalMarkdownImage({
  source,
  alt,
  filePath,
  projectPath,
  resolveImageSource,
}: {
  source: string;
  alt: string;
  filePath?: string;
  projectPath?: string;
  resolveImageSource?: (source: string) => Promise<string | null>;
}) {
  const [resolvedSource, setResolvedSource] = useState<string | null>(() =>
    /^(?:https?:|data:)/i.test(source) ? source : null,
  );

  useEffect(() => {
    if (/^(?:https?:|data:)/i.test(source)) {
      setResolvedSource(source);
      return;
    }
    if (resolveImageSource) {
      let active = true;
      setResolvedSource(null);
      void resolveImageSource(source)
        .then((resolved) => {
          if (active) setResolvedSource(resolved);
        })
        .catch(() => {
          if (active) setResolvedSource(null);
        });
      return () => {
        active = false;
      };
    }
    if (!filePath || !projectPath) {
      setResolvedSource(null);
      return;
    }
    const localPath = resolveMarkdownResourcePath(source, filePath, projectPath);
    if (!localPath) {
      setResolvedSource(null);
      return;
    }

    let active = true;
    setResolvedSource(null);
    void invoke<unknown>("read_file_preview", { path: localPath, projectPath })
      .then(decodeWorkspaceFilePreview)
      .then((preview) => {
        if (active) setResolvedSource(preview.kind === "image" ? imageDataUrl(preview) : null);
      })
      .catch(() => {
        if (active) setResolvedSource(null);
      });
    return () => {
      active = false;
    };
  }, [filePath, projectPath, resolveImageSource, source]);

  if (!resolvedSource) return <span className="md-preview-image-unavailable">{alt}</span>;
  return <img src={resolvedSource} alt={alt} draggable={false} />;
}

async function openExternalLink(href: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(href);
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

export function MarkdownPreview({
  content,
  filePath,
  projectPath,
  className = "md-preview",
  onOpenLocalLink,
  resolveImageSource,
}: {
  content: string;
  filePath?: string;
  projectPath?: string;
  className?: string;
  onOpenLocalLink?: (href: string) => void | Promise<void>;
  resolveImageSource?: (source: string) => Promise<string | null>;
}) {
  const headingsByLine = useMemo(
    () => new Map(parseMarkdownHeadings(content).map((heading) => [heading.line, heading.id])),
    [content],
  );
  const components = useMemo<Components>(() => {
    const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      function Heading({
        node,
        children,
        ...props
      }: ComponentPropsWithoutRef<"h1"> & ExtraProps) {
        return <Tag id={headingsByLine.get(node?.position?.start.line ?? -1)} {...props}>{children}</Tag>;
      };

    return {
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
      a({ href, children, node: _node, ...props }) {
        return <a href={href} {...props}>{children}</a>;
      },
      img({ src, alt }) {
        return (
          <LocalMarkdownImage
            source={typeof src === "string" ? src : ""}
            alt={alt ?? ""}
            filePath={filePath}
            projectPath={projectPath}
            resolveImageSource={resolveImageSource}
          />
        );
      },
    };
  }, [filePath, headingsByLine, projectPath, resolveImageSource]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href")?.trim();
    if (!href) return;
    if (href.startsWith("#")) {
      let id: string;
      try {
        id = decodeURIComponent(href.slice(1));
      } catch {
        return;
      }
      const target = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>("[id]"),
      ).find((element) => element.id === id);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (/^https?:\/\//i.test(href)) {
      void openExternalLink(href);
    } else {
      void onOpenLocalLink?.(href);
    }
  };

  return (
    <div className={className} onClick={handleClick}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
}
