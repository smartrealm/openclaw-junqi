import { ListTree, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MarkdownHeading } from "./MarkdownPreview";

export function MarkdownTableOfContents({
  headings,
  activeId,
  onNavigate,
  onClose,
}: {
  headings: MarkdownHeading[];
  activeId: string | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const minimumDepth = Math.min(...headings.map((heading) => heading.depth));

  return (
    <aside className="markdown-toc-panel" aria-label={t("file.outline", "Outline")}>
      <div className="markdown-toc-header">
        <ListTree size={14} />
        <span>{t("file.outline", "Outline")}</span>
        <button
          type="button"
          onClick={onClose}
          title={t("common.close", "Close")}
          aria-label={t("common.close", "Close")}
        >
          <X size={13} />
        </button>
      </div>
      <nav className="markdown-toc-list">
        {headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            className={activeId === heading.id ? "is-active" : undefined}
            style={{ paddingLeft: 12 + (heading.depth - minimumDepth) * 12 }}
            onClick={() => onNavigate(heading.id)}
            title={heading.text}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
