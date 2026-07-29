import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ExternalFileChangeBanner({
  onReload,
  onKeepEdits,
}: {
  onReload: () => void;
  onKeepEdits: () => void;
}) {
  const { t } = useTranslation();
  const buttonStyle = {
    minHeight: 24,
    maxWidth: "100%",
    padding: "3px 8px",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 11,
    fontFamily: "var(--font-ui, var(--font-sans))",
  } as const;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        padding: "7px 12px",
        borderBottom: "1px solid rgb(217 119 6 / 0.24)",
        background: "rgb(217 119 6 / 0.1)",
        color: "rgb(var(--aegis-text))",
        fontSize: 11.5,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          minWidth: 0,
          lineHeight: 1.4,
        }}
      >
        <TriangleAlert size={14} color="#d97706" style={{ flexShrink: 0 }} />
        {t(
          "file.externalChangeConflict",
          "This file changed on disk while you have unsaved edits. Keeping your edits will overwrite the newer disk content.",
        )}
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
          gap: 6,
          marginLeft: "auto",
          maxWidth: "100%",
        }}
      >
        <button
          type="button"
          onClick={onReload}
          title={t(
            "file.reloadFromDiskHint",
            "Discard unsaved edits and replace the editor with the file on disk",
          )}
          style={{
            ...buttonStyle,
            border: "1px solid var(--aegis-border)",
            background: "var(--aegis-surface)",
            color: "rgb(var(--aegis-text))",
          }}
        >
          {t("file.reloadFromDisk", "Reload from disk")}
        </button>
        <button
          type="button"
          onClick={onKeepEdits}
          title={t(
            "file.keepLocalEditsHint",
            "Keep your editor content and allow it to replace the file on disk",
          )}
          style={{
            ...buttonStyle,
            border: "none",
            background: "transparent",
            color: "rgb(var(--aegis-text-secondary))",
          }}
        >
          {t("file.keepLocalEdits", "Keep my edits")}
        </button>
      </span>
    </div>
  );
}
