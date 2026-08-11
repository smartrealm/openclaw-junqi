// 终端窗格底部内嵌 Prompt 输入框。
// 默认收起，快捷键触发展开。Return 发送，Shift+Return 换行，Esc 关闭。

import { useRef, useEffect, useCallback } from "react";
import { useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

export interface PaneComposerBarProps {
  isOpen: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  onClose: () => void;
}

export function PaneComposerBar({
  isOpen,
  draft,
  onDraftChange,
  onSend,
  onClose,
}: PaneComposerBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  // 打开时自动聚焦
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // 键盘处理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        if (e.shiftKey) return; // Shift+Return = 换行
        e.preventDefault();
        const text = draft.trim();
        if (text) onSend(text);
      }
    },
    [draft, onSend, onClose],
  );

  const handleSendClick = useCallback(() => {
    const text = draft.trim();
    if (text) onSend(text);
  }, [draft, onSend]);

  return (
    <div
      aria-hidden={!isOpen}
      style={{
        flexShrink: 0,
        overflow: "hidden",
        // 保持容器挂载，以便收起和展开能使用同一条真实布局过渡。
        borderTop: `1px solid ${isOpen ? "var(--aegis-border)" : "transparent"}`,
        background: "rgb(var(--aegis-surface))",
        maxHeight: isOpen ? 288 : 0,
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? "translateY(0)" : "translateY(100%)",
        pointerEvents: isOpen ? "auto" : "none",
        flexDirection: "column",
        transition: reduceMotion
          ? "none"
          : "max-height var(--aegis-duration-slow) var(--aegis-ease-standard), opacity var(--aegis-duration-normal) var(--aegis-ease-standard), transform var(--aegis-duration-slow) var(--aegis-ease-standard)",
      }}
    >
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={handleKeyDown}
        tabIndex={isOpen ? undefined : -1}
        placeholder={t('common.enterPrompt', '输入 Prompt…')}
        style={{
          flex: 1,
          minHeight: 80,
          maxHeight: 240,
          background: "rgb(var(--aegis-surface))",
          border: "1px solid var(--aegis-border-hover)",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          fontFamily: '"JetBrains Mono", monospace',
          color: "rgb(var(--aegis-text))",
          resize: "none",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
          lineHeight: 1.5,
        }}
      />

      {/* 底部操作栏 */}
      <div
        style={{
          height: 32,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: '"JetBrains Mono", monospace',
            color: "rgb(var(--aegis-text-dim))",
            opacity: 0.5,
          }}
        >
          Return 发送 · Shift+Return 换行 · Esc 关闭
        </span>
        <button
          onClick={handleSendClick}
          tabIndex={isOpen ? undefined : -1}
          disabled={!draft.trim()}
          style={{
            padding: "2px 16px",
            height: 24,
            borderRadius: 4,
            border: "none",
            background: draft.trim()
              ? "rgb(var(--aegis-primary))"
              : "rgb(var(--aegis-overlay)/0.10)",
            color: draft.trim() ? "var(--aegis-btn-primary-text)" : "rgb(var(--aegis-text-dim))",
            fontSize: 12,
            fontFamily: '"JetBrains Mono", monospace',
            cursor: draft.trim() ? "pointer" : "default",
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
