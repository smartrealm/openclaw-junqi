import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EditorDocumentStatus } from "@/workspace-files/services/editorDocumentManager";

interface FilePreviewStatusBarProps {
  filePath: string;
  makeTargets: string[];
  status: EditorDocumentStatus | null;
  statusLabel: string | null;
  retrySaveDisabled: boolean;
  onRunMakeTarget?: (target: string) => void;
  onRetrySave: () => void;
}

export function FilePreviewStatusBar({
  filePath,
  makeTargets,
  status,
  statusLabel,
  retrySaveDisabled,
  onRunMakeTarget,
  onRetrySave,
}: FilePreviewStatusBarProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderTop: "1px solid var(--aegis-border)",
        background: "var(--aegis-surface)",
        flexShrink: 0,
        gap: 8,
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 11,
          color: "var(--aegis-text-muted)",
          fontFamily: "var(--aegis-body)",
        }}
      >
        {filePath}
      </span>
      {makeTargets.length > 0 && onRunMakeTarget ? (
        <div
          style={{
            display: "flex",
            gap: 4,
            marginLeft: 12,
            paddingLeft: 12,
            borderLeft: "1px solid var(--aegis-border)",
            overflowX: "auto",
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--aegis-text-dim)" }}>
            {t("file.makeTargets", "Make")}
          </span>
          {makeTargets.map((target) => (
            <button
              key={target}
              type="button"
              onClick={() => onRunMakeTarget(target)}
              title={`Run make ${target}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "1px 6px",
                border: "1px solid var(--aegis-border)",
                borderRadius: 4,
                background: "transparent",
                color: "var(--aegis-text-secondary)",
                fontSize: 10,
                fontFamily: "var(--aegis-mono, monospace)",
                cursor: "pointer",
              }}
            >
              <Play size={10} aria-hidden="true" />
              {target}
            </button>
          ))}
        </div>
      ) : null}
      {status === "error" ? (
        <button
          type="button"
          onClick={onRetrySave}
          disabled={retrySaveDisabled}
          style={{
            marginLeft: "auto",
            border: "1px solid var(--aegis-danger)",
            borderRadius: 4,
            padding: "2px 7px",
            color: "var(--aegis-danger)",
            background: "transparent",
            fontSize: 10.5,
          }}
        >
          {t("file.retrySave", "Retry save")}
        </button>
      ) : null}
      {statusLabel ? (
        <span
          style={{
            marginLeft: status === "error" ? 6 : "auto",
            fontSize: 11,
            color: status === "error"
              ? "var(--aegis-danger)"
              : status === "conflicted"
                ? "var(--aegis-warning)"
                : "var(--aegis-text-muted)",
            fontFamily: "var(--aegis-body)",
          }}
        >
          {statusLabel}
        </span>
      ) : null}
    </div>
  );
}
