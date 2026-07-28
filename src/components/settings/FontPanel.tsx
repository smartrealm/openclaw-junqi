import { useTranslation } from "react-i18next";
import { FontSelector } from "./FontSelector";

interface FontPanelProps {
  uiFont: string;
  onUiFontChange: (font: string) => void;
  editorFont: string;
  onEditorFontChange: (font: string) => void;
}

export function FontPanel({
  uiFont,
  onUiFontChange,
  editorFont,
  onEditorFontChange,
}: FontPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="divide-y divide-aegis-border/60">
      <FontSelector
        value={uiFont}
        onChange={onUiFontChange}
        label={t("font.uiFont", "Interface font")}
        description={t("font.uiFontHint", "Used throughout navigation, settings, and application controls.")}
        defaultLabel={t("font.junqiDefault", "JunQi default")}
        role="ui"
      />
      <FontSelector
        value={editorFont}
        onChange={onEditorFontChange}
        label={t("font.editorFont", "Editor font")}
        description={t("font.editorFontHint", "Used by file editors and diff views. Clear it to follow the terminal font.")}
        defaultLabel={t("font.followTerminal", "Same as terminal font")}
        role="editor"
      />
      <div className="grid gap-3 pt-4 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase text-aegis-text-dim">{t("font.interfacePreview", "Interface")}</div>
          <p className="mt-2 text-[14px] leading-relaxed text-aegis-text" style={{ fontFamily: uiFont || undefined }}>
            {t("font.previewUI", "The quick brown fox jumps over the lazy dog.")}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase text-aegis-text-dim">{t("font.editorPreview", "Editor")}</div>
          <p className="mt-2 text-[13px] leading-relaxed text-aegis-text-muted" style={{ fontFamily: editorFont || "var(--font-mono)" }}>
            {t("font.previewMono", "console.log('Hello, world!'); // 1234567890")}
          </p>
        </div>
      </div>
    </div>
  );
}
