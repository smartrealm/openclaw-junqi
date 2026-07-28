import { FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";

export function FileUnavailableBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        padding: "7px 12px",
        borderBottom: "1px solid rgb(220 38 38 / 0.2)",
        background: "rgb(220 38 38 / 0.08)",
        color: "rgb(var(--aegis-text))",
        fontSize: 11.5,
        flexShrink: 0,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 7, lineHeight: 1.4 }}>
        <FileWarning size={14} color="#dc2626" style={{ flexShrink: 0 }} />
        {t(
          "file.unavailableOnDiskHint",
          "This file cannot be read from disk. Saving is paused until it becomes available.",
        )}
      </span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          minHeight: 24,
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid var(--aegis-border)",
          background: "var(--aegis-surface)",
          color: "rgb(var(--aegis-text))",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "var(--font-ui, var(--font-sans))",
        }}
      >
        {t("common.retry", "Retry")}
      </button>
    </div>
  );
}
