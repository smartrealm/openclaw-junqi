// ═══════════════════════════════════════════════════════════
// FileExplorer — CreateInputRow (inline name input for new file/folder)
// ═══════════════════════════════════════════════════════════

import { useEffect } from "react";
import { FolderPlus, FilePlus } from "lucide-react";
import type { CreateKind } from "./types";

export function CreateInputRow({
  depth,
  kind,
  value,
  onChange,
  onCommit,
  onCancel,
  inputRef,
}: {
  depth: number;
  kind: CreateKind;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  const padLeft = 16 + depth * 16 + 2;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: 24, // matches ROW_HEIGHT
        paddingRight: 8,
        margin: "0 4px",
        boxSizing: "border-box",
        background: "var(--aegis-primary-surface)",
        borderRadius: 4,
      }}
    >
      <div style={{ width: padLeft, flexShrink: 0 }} />

      {/* Icon */}
      <span
        style={{
          width: 14,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--aegis-primary)",
        }}
      >
        {kind === "folder" ? <FolderPlus size={14} /> : <FilePlus size={13} />}
      </span>

      {/* Input */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCommit()}
        placeholder={kind === "folder" ? "New folder" : "New file"}
        style={{
          flex: 1,
          minWidth: 0,
          height: 18,
          padding: "0 4px",
          fontSize: 12,
          fontFamily: "var(--aegis-body)",
          color: "var(--aegis-text)",
          background: "var(--aegis-input)",
          border: "1px solid var(--aegis-primary)",
          borderRadius: 3,
          outline: "none",
        }}
      />
    </div>
  );
}
