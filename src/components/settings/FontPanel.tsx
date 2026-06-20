import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FontSelector } from "./FontSelector";
import type { FontFamily } from "./FontSelector";

// ═══════════════════════════════════════════════════════════
// Default font stacks — mirrors nezha defaults
// ═══════════════════════════════════════════════════════════
export const DEFAULT_UI_FONT: FontFamily =
  '"SF Pro Display", "IBM Plex Sans", "PingFang SC", "Noto Sans SC", sans-serif';

const MONO_FONT_WINDOWS: FontFamily = "Consolas";
const MONO_FONT_MAC: FontFamily =
  '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, ui-monospace, monospace';
const MONO_FONT_LINUX: FontFamily =
  '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", "Liberation Mono", ui-monospace, monospace';
const MONO_FONT_FALLBACK: FontFamily =
  '"JetBrains Mono", "Fira Code", ui-monospace, monospace';

function getDefaultMonoFont(): FontFamily {
  if (typeof navigator === "undefined") return MONO_FONT_FALLBACK;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return MONO_FONT_WINDOWS;
  if (/Mac OS X|Macintosh/i.test(ua)) return MONO_FONT_MAC;
  if (/Linux/i.test(ua)) return MONO_FONT_LINUX;
  return MONO_FONT_FALLBACK;
}

// ═══════════════════════════════════════════════════════════
// Aegis CSS variable helpers for inline styles
// ═══════════════════════════════════════════════════════════
const v = {
  text: "rgb(var(--aegis-text))",
  textSecondary: "rgb(var(--aegis-text-secondary))",
  textMuted: "rgb(var(--aegis-text-muted))",
  textDim: "rgb(var(--aegis-text-dim))",
  card: "var(--aegis-card)",
  elevated: "var(--aegis-elevated)",
  input: "var(--aegis-input)",
  hover: "var(--aegis-hover)",
  border: "var(--aegis-border)",
  borderHover: "var(--aegis-border-hover)",
  primary: "rgb(var(--aegis-primary))",
};

interface FontPanelProps {
  uiFont: FontFamily;
  monoFont: FontFamily;
  onUiFontChange: (family: FontFamily) => void;
  onMonoFontChange: (family: FontFamily) => void;
}

export function FontPanel({
  uiFont,
  monoFont,
  onUiFontChange,
  onMonoFontChange,
}: FontPanelProps) {
  const { t } = useTranslation();

  const [pendingUiFont, setPendingUiFont] = useState(uiFont);
  const [pendingMonoFont, setPendingMonoFont] = useState(monoFont);

  const dirty =
    pendingUiFont !== uiFont || pendingMonoFont !== monoFont;

  function handleSave() {
    onUiFontChange(pendingUiFont);
    onMonoFontChange(pendingMonoFont);
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {/* UI Font */}
      <FontSelector
        value={pendingUiFont || DEFAULT_UI_FONT}
        onChange={setPendingUiFont}
        label={t("settings.fontUiFamily", "UI Font")}
        hint={t(
          "settings.fontUiFamilyHint",
          "Used for menus, labels, sidebar text, and overall chrome",
        )}
        defaultFont={DEFAULT_UI_FONT}
        preview={
          <div
            style={{
              marginTop: 4,
              padding: "10px 12px",
              borderRadius: 6,
              border: `1px solid ${v.border}`,
              background: v.card,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: v.textSecondary,
              }}
            >
              {t("settings.fontPreview", "Preview")}
            </span>
            <span
              style={{
                fontSize: 13,
                color: v.text,
                lineHeight: 1.5,
                fontFamily: pendingUiFont || DEFAULT_UI_FONT,
              }}
            >
              {"这是一段测试文字，用于预览字体效果。"}
            </span>
            <span
              style={{
                fontSize: 13,
                color: v.text,
                lineHeight: 1.5,
                fontFamily: pendingUiFont || DEFAULT_UI_FONT,
              }}
            >
              {"The quick brown fox jumps over the lazy dog."}
            </span>
            <span
              style={{
                fontSize: 13,
                color: v.text,
                lineHeight: 1.5,
                fontFamily: pendingUiFont || DEFAULT_UI_FONT,
              }}
            >
              {'0123456789 !@#$%^&*()_+-={"{}"}[]|:;"\'<>,.?/'}
            </span>
          </div>
        }
      />

      {/* Mono Font */}
      <FontSelector
        value={pendingMonoFont || getDefaultMonoFont()}
        onChange={setPendingMonoFont}
        label={t("settings.fontMonoFamily", "Monospace Font")}
        hint={t(
          "settings.fontMonoFamilyHint",
          "Used for code, terminals, and numeric displays",
        )}
        defaultFont={getDefaultMonoFont()}
        preview={
          <div
            style={{
              marginTop: 4,
              padding: "10px 12px",
              borderRadius: 6,
              border: `1px solid ${v.border}`,
              background: v.card,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: v.textSecondary,
                }}
              >
                {t("settings.fontPreview", "Preview")}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: v.textDim,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {"0O · 1lI · {}[]()"}
              </span>
            </div>
            <div
              style={{
                margin: 0,
                padding: "10px 0",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.09)",
                background: "linear-gradient(180deg, #171b24, #10141d)",
                color: "#d6deeb",
                boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.16))",
                overflowX: "auto",
                lineHeight: 1.55,
                fontFamily: pendingMonoFont || getDefaultMonoFont(),
              }}
            >
              <div
                style={{
                  display: "flex",
                  minWidth: "max-content",
                }}
              >
                <span
                  style={{
                    width: 34,
                    paddingRight: 10,
                    color: "rgba(214,222,235,0.36)",
                    textAlign: "right",
                    userSelect: "none",
                    flexShrink: 0,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  1
                </span>
                <span
                  style={{
                    paddingRight: 14,
                    whiteSpace: "pre",
                  }}
                >
                  <span style={{ color: "#c792ea", fontWeight: 650 }}>
                    const
                  </span>{" "}
                  {"task = {"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  minWidth: "max-content",
                }}
              >
                <span
                  style={{
                    width: 34,
                    paddingRight: 10,
                    color: "rgba(214,222,235,0.36)",
                    textAlign: "right",
                    userSelect: "none",
                    flexShrink: 0,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  2
                </span>
                <span
                  style={{
                    paddingRight: 14,
                    whiteSpace: "pre",
                  }}
                >
                  {"  "}
                  {"name: "}
                  <span style={{ color: "#ecc48d" }}>{'"JunQi"'}</span>
                  {", status: "}
                  <span style={{ color: "#ecc48d" }}>{'"running"'}</span>
                  {","}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  minWidth: "max-content",
                }}
              >
                <span
                  style={{
                    width: 34,
                    paddingRight: 10,
                    color: "rgba(214,222,235,0.36)",
                    textAlign: "right",
                    userSelect: "none",
                    flexShrink: 0,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  3
                </span>
                <span
                  style={{
                    paddingRight: 14,
                    whiteSpace: "pre",
                  }}
                >
                  {"  "}
                  {"tokens: "}
                  <span style={{ color: "#f78c6c" }}>24860</span>
                  {`, tools: [`}
                  <span style={{ color: "#ecc48d" }}>{'"read"'}</span>
                  {", "}
                  <span style={{ color: "#ecc48d" }}>{'"edit"'}</span>
                  {"],"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  minWidth: "max-content",
                }}
              >
                <span
                  style={{
                    width: 34,
                    paddingRight: 10,
                    color: "rgba(214,222,235,0.36)",
                    textAlign: "right",
                    userSelect: "none",
                    flexShrink: 0,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  4
                </span>
                <span
                  style={{
                    paddingRight: 14,
                    whiteSpace: "pre",
                  }}
                >
                  {"}"}{" "}
                  <span style={{ color: "#7f8da3", fontStyle: "italic" }}>
                    {"// 0O 1lI == => =< =>"}
                  </span>
                </span>
              </div>
            </div>
          </div>
        }
      />

      {/* Apply Button */}
      {dirty && (
        <button
          type="button"
          onClick={handleSave}
          style={{
            padding: "8px 20px",
            borderRadius: 6,
            border: "none",
            background: "rgb(var(--aegis-primary))",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            alignSelf: "flex-end",
          }}
        >
          {t("common.apply", "Apply")}
        </button>
      )}
    </div>
  );
}
