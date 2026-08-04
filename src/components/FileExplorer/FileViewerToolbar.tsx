import { Code, Copy, ExternalLink, Eye, ListTree, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FileViewMode } from "./fileViewerModel";

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "file-viewer-mode-button is-active" : "file-viewer-mode-button"}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function FileViewerToolbar({
  relativePath,
  isMarkdown,
  isPreviewable,
  viewMode,
  tableOfContentsVisible,
  tableOfContentsAvailable,
  wordWrap,
  onViewModeChange,
  onToggleTableOfContents,
  onToggleWordWrap,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
}: {
  relativePath: string;
  isMarkdown: boolean;
  isPreviewable: boolean;
  viewMode: FileViewMode;
  tableOfContentsVisible: boolean;
  tableOfContentsAvailable: boolean;
  wordWrap: boolean;
  onViewModeChange: (mode: FileViewMode) => void;
  onToggleTableOfContents: () => void;
  onToggleWordWrap: () => void;
  onCopyPath: () => void;
  onCopyRelativePath: () => void;
  onReveal: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="file-viewer-toolbar">
      <span className="file-viewer-toolbar-path" title={relativePath}>{relativePath}</span>
      <div className="file-viewer-toolbar-actions">
        {isPreviewable && (
          <div className="file-viewer-mode-switch" role="group" aria-label={t("file.viewMode", "View mode")}>
            <ViewButton
              active={viewMode === "source"}
              label={t("file.source", "Source")}
              onClick={() => onViewModeChange("source")}
            >
              <Code size={14} />
            </ViewButton>
            <ViewButton
              active={viewMode === "preview"}
              label={t("common.preview", "Preview")}
              onClick={() => onViewModeChange("preview")}
            >
              <Eye size={14} />
            </ViewButton>
          </div>
        )}
        {isMarkdown && (
          <button
            type="button"
            className={tableOfContentsVisible ? "file-viewer-icon-button is-active" : "file-viewer-icon-button"}
            onClick={onToggleTableOfContents}
            disabled={!tableOfContentsAvailable || viewMode !== "preview"}
            title={t("file.outline", "Outline")}
            aria-label={t("file.outline", "Outline")}
            aria-pressed={tableOfContentsVisible}
          >
            <ListTree size={14} />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="file-viewer-icon-button"
              title={t("file.moreActions", "More actions")}
              aria-label={t("file.moreActions", "More actions")}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52 text-xs">
            <DropdownMenuCheckboxItem checked={wordWrap} onCheckedChange={onToggleWordWrap}>
              {t("file.wordWrap", "Word wrap")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCopyPath}>
              <Copy />
              <span className="mr-auto">{t("file.copyPath", "Copy path")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopyRelativePath}>
              <Copy />
              <span className="mr-auto">{t("file.copyRelativePath", "Copy relative path")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReveal}>
              <ExternalLink />
              <span className="mr-auto">{t("file.revealInFileManager", "Reveal in file manager")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
