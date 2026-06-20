// ═══════════════════════════════════════════════════════════
// FileExplorer — context menu
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ContextMenuState } from "./types";

export function FileExplorerContextMenu({
  ctxMenu,
  onClose,
  onNewFile,
  onNewFolder,
  onDelete,
  onOpenInSystem,
  onCopyPath,
}: {
  ctxMenu: ContextMenuState;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onDelete: () => void;
  onOpenInSystem: (event: React.MouseEvent, path: string) => void;
  onCopyPath: (event: React.MouseEvent, path: string, withAt: boolean) => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

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
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onClick, true);
    };
  }, [onClose]);

  // Compute position clamped to viewport
  const pad = 8;
  const left = Math.min(ctxMenu.x, window.innerWidth - 160 - pad);
  const top = Math.min(ctxMenu.y, window.innerHeight - 180 - pad);

  return (
    <>
      {/* Transparent backdrop to capture clicks outside */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999,
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
          left,
          top,
          zIndex: 1000,
          background: "var(--aegis-elevated-solid, var(--aegis-elevated))",
          border: "1px solid var(--aegis-border)",
          borderRadius: 8,
          boxShadow: "var(--aegis-menu-shadow, 0 8px 32px rgba(0,0,0,0.32))",
          minWidth: 150,
          padding: "4px 0",
          fontSize: 12,
          color: "var(--aegis-menu-text)",
        }}
      >
        <MenuItem
          label={t("file.newFile", "New File")}
          onClick={onNewFile}
        />
        <MenuItem
          label={t("file.newFolder", "New Folder")}
          onClick={onNewFolder}
        />
        <Separator />
        <MenuItem
          label={t("file.copyFullPath", "Copy full path")}
          onClick={(e) => onCopyPath(e, ctxMenu.path, false)}
        />
        <MenuItem
          label={t("file.copyAtFullPath", "Copy @full path")}
          onClick={(e) => onCopyPath(e, ctxMenu.path, true)}
        />
        <MenuItem
          label={t("file.openInSystemFolder", "Open in System Folder")}
          onClick={(e) => onOpenInSystem(e, ctxMenu.path)}
        />
        {!ctxMenu.isRoot && (
          <>
            <Separator />
            <MenuItem
              label={t("file.delete", "Delete")}
              onClick={onDelete}
              danger
            />
          </>
        )}
      </div>
    </>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      style={{
        display: "block",
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
        fontFamily: "var(--aegis-body)",
        color: danger ? "var(--aegis-danger)" : "var(--aegis-menu-text)",
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--aegis-menu-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
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
