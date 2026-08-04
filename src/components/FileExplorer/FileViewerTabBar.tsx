import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fileTabColor } from "./fileViewerCapabilities";
import type { OpenFileTab } from "./fileViewerTypes";

interface FileViewerTabBarProps {
  tabs: OpenFileTab[];
  activePath: string;
  onSelect: (path: string) => void;
  onClosePaths: (paths: string[], commit: () => void) => void;
  onCloseTab: (path: string) => void;
  onCloseOtherTabs: (path: string) => void;
  onCloseTabsToRight: (path: string) => void;
  onCloseTabsToLeft: (path: string) => void;
  onCloseAllTabs: () => void;
}

interface TabMenuState {
  x: number;
  y: number;
  path: string;
}

export function FileViewerTabBar({
  tabs,
  activePath,
  onSelect,
  onClosePaths,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseTabsToLeft,
  onCloseAllTabs,
}: FileViewerTabBarProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const margin = 8;
    setMenuPosition({
      left: Math.max(margin, Math.min(menu.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(menu.y, window.innerHeight - height - margin)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const close = () => setMenu(null);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const menuIndex = menu ? tabs.findIndex((tab) => tab.path === menu.path) : -1;
  const pathsExcept = (path: string) => tabs.filter((tab) => tab.path !== path).map((tab) => tab.path);
  const pathsRightOf = (path: string) => tabs.slice(tabs.findIndex((tab) => tab.path === path) + 1).map((tab) => tab.path);
  const pathsLeftOf = (path: string) => tabs.slice(0, Math.max(0, tabs.findIndex((tab) => tab.path === path))).map((tab) => tab.path);
  const close = (paths: string[], commit: () => void) => {
    onClosePaths(paths, commit);
    setMenu(null);
  };

  return (
    <>
      <div
        className="file-viewer-tab-strip"
        style={{
          height: 40,
          display: "flex",
          alignItems: "stretch",
          overflowX: "auto",
          overflowY: "hidden",
          borderBottom: "1px solid var(--aegis-border)",
          background: "var(--aegis-surface)",
          paddingLeft: 4,
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.path === activePath;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => onSelect(tab.path)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuPosition(null);
                setMenu({ x: event.clientX, y: event.clientY, path: tab.path });
              }}
              title={tab.path}
              style={{
                height: "100%",
                maxWidth: 220,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px 0 12px",
                border: "none",
                borderRight: "1px solid var(--aegis-border)",
                borderTop: active ? "2px solid var(--aegis-primary)" : "2px solid transparent",
                background: active ? "var(--aegis-elevated)" : "transparent",
                color: active ? "var(--aegis-text)" : "var(--aegis-text-secondary)",
                fontSize: 12.5,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <span style={{ width: 5, height: 14, borderRadius: 2, background: fileTabColor(tab.name), flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.name}</span>
              <span
                role="button"
                aria-label={t("file.closeTab", { name: tab.name })}
                onClick={(event) => {
                  event.stopPropagation();
                  onClosePaths([tab.path], () => onCloseTab(tab.path));
                }}
                style={{ display: "flex", padding: 2, color: "var(--aegis-text-dim)" }}
              >
                <X size={12} />
              </span>
            </button>
          );
        })}
      </div>
      {menu && menuIndex >= 0 ? createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: menuPosition?.left ?? menu.x,
            top: menuPosition?.top ?? menu.y,
            visibility: menuPosition ? "visible" : "hidden",
            zIndex: 300,
            minWidth: 170,
            padding: "4px 0",
            border: "1px solid var(--aegis-menu-border)",
            borderRadius: 6,
            boxShadow: "var(--aegis-shadow-popover)",
            background: "var(--aegis-menu-bg)",
          }}
        >
          <TabMenuItem label={t("file.closeThisTab", "Close")} onClick={() => close([menu.path], () => onCloseTab(menu.path))} />
          <TabMenuItem label={t("file.closeOtherTabs", "Close Other Tabs")} disabled={tabs.length <= 1} onClick={() => close(pathsExcept(menu.path), () => onCloseOtherTabs(menu.path))} />
          <TabMenuItem label={t("file.closeTabsToRight", "Close Tabs to the Right")} disabled={menuIndex >= tabs.length - 1} onClick={() => close(pathsRightOf(menu.path), () => onCloseTabsToRight(menu.path))} />
          <TabMenuItem label={t("file.closeTabsToLeft", "Close Tabs to the Left")} disabled={menuIndex <= 0} onClick={() => close(pathsLeftOf(menu.path), () => onCloseTabsToLeft(menu.path))} />
          <TabMenuItem label={t("file.closeAllTabs", "Close All Tabs")} onClick={() => close(tabs.map((tab) => tab.path), onCloseAllTabs)} />
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function TabMenuItem({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "block",
        width: "calc(100% - 8px)",
        height: 28,
        margin: "1px 4px",
        padding: "0 10px",
        border: "none",
        borderRadius: 4,
        background: "transparent",
        color: disabled ? "var(--aegis-text-dim)" : "var(--aegis-menu-text)",
        textAlign: "left",
        fontSize: 12,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  );
}
