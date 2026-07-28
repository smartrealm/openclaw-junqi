// ═══════════════════════════════════════════════════════════
// FileExplorer — context menu
// ═══════════════════════════════════════════════════════════

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Copy,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  getFileExplorerMenuSections,
  type FileExplorerMenuAction,
} from "./contextMenuModel";
import type { ContextMenuState } from "./types";

export interface FileExplorerContextMenuExtraAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

export function FileExplorerContextMenu({
  ctxMenu,
  onClose,
  onNewFile,
  onNewFolder,
  onOpen,
  onRename,
  onDelete,
  onOpenInSystem,
  onCopyPath,
  extraActions = [],
}: {
  ctxMenu: ContextMenuState;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenInSystem: (path: string) => void;
  onCopyPath: (path: string, withAt: boolean) => void;
  extraActions?: FileExplorerContextMenuExtraAction[];
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const sections = useMemo(() => {
    const coreSections = getFileExplorerMenuSections(ctxMenu);
    if (extraActions.length === 0) return coreSections;
    const insertAt = ctxMenu.isRoot ? coreSections.length : coreSections.length - 1;
    return [
      ...coreSections.slice(0, insertAt),
      extraActions.map((action) => `extra:${action.id}` as const),
      ...coreSections.slice(insertAt),
    ];
  }, [ctxMenu, extraActions]);

  const renderCoreAction = (action: FileExplorerMenuAction) => {
    switch (action) {
      case "new-file":
        return <MenuItem label={t("file.newFile", "New File")} icon={<FilePlus size={14} />} onClick={onNewFile} />;
      case "new-folder":
        return <MenuItem label={t("file.newFolder", "New Folder")} icon={<FolderPlus size={14} />} onClick={onNewFolder} />;
      case "open":
        return <MenuItem label={t("file.open", "Open")} icon={<FolderOpen size={14} />} onClick={onOpen} />;
      case "rename":
        return <MenuItem label={t("file.rename", "Rename")} icon={<Pencil size={14} />} onClick={onRename} />;
      case "copy-path":
        return <MenuItem label={t("file.copyFullPath", "Copy full path")} icon={<Copy size={14} />} onClick={() => onCopyPath(ctxMenu.path, false)} />;
      case "copy-at-path":
        return <MenuItem label={t("file.copyAtFullPath", "Copy @full path")} icon={<Copy size={14} />} onClick={() => onCopyPath(ctxMenu.path, true)} />;
      case "reveal":
        return <MenuItem label={t("file.openInSystemFolder", "Open in System Folder")} icon={<ExternalLink size={14} />} onClick={() => onOpenInSystem(ctxMenu.path)} />;
      case "delete":
        return <MenuItem label={t("file.delete", "Delete")} icon={<Trash2 size={14} />} onClick={onDelete} danger />;
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onClick, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onClick, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(ctxMenu.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(ctxMenu.y, window.innerHeight - height - margin)),
    });
  }, [ctxMenu]);

  return createPortal(
    <>
      {/* Transparent backdrop to capture clicks outside */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483000,
        }}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          left: position?.left ?? ctxMenu.x,
          top: position?.top ?? ctxMenu.y,
          visibility: position ? "visible" : "hidden",
          zIndex: 2147483001,
          background: "var(--aegis-elevated-solid, var(--aegis-elevated))",
          border: "1px solid var(--aegis-border)",
          borderRadius: 8,
          boxShadow: "var(--aegis-menu-shadow, 0 8px 32px rgba(0,0,0,0.32))",
          minWidth: 150,
          padding: "4px 0",
          fontSize: 12,
          color: "rgb(var(--aegis-menu-text))",
        }}
      >
        {sections.map((section, sectionIndex) => (
          <div key={section.join("|")}>
            {sectionIndex > 0 && <Separator />}
            {section.map((action) => {
              if (action.startsWith("extra:")) {
                const extra = extraActions.find((candidate) => `extra:${candidate.id}` === action);
                return extra ? (
                  <MenuItem
                    key={action}
                    label={extra.label}
                    icon={extra.icon}
                    onClick={extra.onSelect}
                    danger={extra.danger}
                  />
                ) : null;
              }
              return (
                <Fragment key={action}>
                  {renderCoreAction(action as FileExplorerMenuAction)}
                </Fragment>
              );
            })}
          </div>
        ))}
      </div>
    </>,
    document.body,
  );
}

function MenuItem({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "calc(100% - 8px)",
        height: 28,
        padding: "0 10px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        borderRadius: 4,
        margin: "1px 4px",
        border: "none",
        textAlign: "left",
        fontSize: 12,
        fontFamily: "var(--font-ui, var(--font-sans))",
        color: danger ? "var(--aegis-danger)" : "rgb(var(--aegis-menu-text))",
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--aegis-menu-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}

function Separator() {
  return (
    <div
      style={{
        height: 1,
        background: "var(--aegis-border)",
        margin: "4px 6px",
      }}
    />
  );
}
