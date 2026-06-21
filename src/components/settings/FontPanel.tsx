import { useTranslation } from "react-i18next";
import { FontSelector } from "./FontSelector";
import { parseFirstFontName } from "@/utils/fonts";

interface FontPanelProps {
  uiFont: string;
  onUiFontChange: (f: string) => void;
  monoFont: string;
  onMonoFontChange: (f: string) => void;
}

export function FontPanel({ uiFont, onUiFontChange, monoFont, onMonoFontChange }: FontPanelProps) {
  const { t } = useTranslation();

  const UI_DEFAULT = "";
  const MONO_DEFAULT = "";

  return (
    <div className="flex flex-col gap-4 mt-3 pt-4 border-t border-aegis-border">
      <div className="flex flex-col gap-3">
        <FontSelector
          value={uiFont}
          onChange={onUiFontChange}
          label={t("font.uiFont", "UI Font")}
          defaultFont={UI_DEFAULT}
        />
        <FontSelector
          value={monoFont}
          onChange={onMonoFontChange}
          label={t("font.monoFont", "Monospace Font")}
          defaultFont={MONO_DEFAULT}
        />
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-aegis-border bg-aegis-surface-elevated p-4">
        <span className="text-[11px] font-semibold text-aegis-text-muted tracking-wide uppercase">
          {t("font.preview", "Preview")}
        </span>
        <div className="mt-3 space-y-2">
          <p
            className="text-[14px] leading-relaxed"
            style={{ fontFamily: uiFont ? `"${parseFirstFontName(uiFont)}"` : "inherit" }}
          >
            {t("font.previewUI", "The quick brown fox jumps over the lazy dog.")}
          </p>
          <p
            className="text-[13px] leading-relaxed text-aegis-text-muted"
            style={{ fontFamily: monoFont ? `"${parseFirstFontName(monoFont)}"` : "inherit" }}
          >
            {t("font.previewMono", "console.log('Hello, world!'); // 1234567890")}
          </p>
        </div>
      </div>
    </div>
  );
}
