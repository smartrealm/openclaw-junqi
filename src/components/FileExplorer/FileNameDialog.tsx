import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export type FileNameDialogRequest = {
  mode: "new-file" | "new-folder" | "rename";
  initialValue: string;
};

export function FileNameDialog({
  request,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  request: FileNameDialogRequest;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(request.initialValue);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setValue(request.initialValue);
    setValidationError(null);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [request]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, onCancel]);

  const title = request.mode === "rename"
    ? t("file.rename", "Rename")
    : request.mode === "new-folder"
      ? t("file.newFolder", "New Folder")
      : t("file.newFile", "New File");
  const visibleError = validationError ?? error;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483100] flex items-center justify-center bg-black/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={visibleError ? errorId : undefined}
        className="w-full max-w-sm rounded-lg border border-aegis-border p-4 shadow-2xl"
        style={{ background: "var(--aegis-elevated-solid, var(--aegis-elevated))" }}
        onSubmit={(event) => {
          event.preventDefault();
          const name = value.trim();
          if (!name) {
            setValidationError(t("file.nameRequired", "Enter a name."));
            return;
          }
          if (name.includes("/") || name.includes("\\")) {
            setValidationError(t("file.invalidName", "A name cannot contain path separators."));
            return;
          }
          setValidationError(null);
          onSubmit(name);
        }}
      >
        <h2 id={titleId} className="text-sm font-semibold text-aegis-text">{title}</h2>
        <input
          ref={inputRef}
          value={value}
          disabled={busy}
          aria-invalid={visibleError ? true : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setValidationError(null);
          }}
          className="mt-3 h-9 w-full rounded border border-aegis-border bg-aegis-bg px-2.5 text-sm text-aegis-text outline-none focus:border-aegis-primary focus:ring-1 focus:ring-aegis-primary disabled:opacity-60"
        />
        {visibleError && (
          <p id={errorId} role="alert" className="mt-2 break-words text-xs text-aegis-danger">
            {visibleError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-8 rounded px-3 text-xs text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-50"
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-8 rounded bg-aegis-primary px-3 text-xs font-medium text-white hover:brightness-105 disabled:opacity-50"
          >
            {busy ? t("common.processing", "Working...") : t("common.confirm", "Confirm")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
