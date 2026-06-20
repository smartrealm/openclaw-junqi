import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Search, ChevronDown, RotateCcw, Check, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import type React from "react";
import { useTranslation } from "react-i18next";
import {
  loadSystemFonts,
  parseFirstFontName,
  filterFonts,
  quoteFontName,
} from "@/utils/fonts";

const FONT_ITEM_HEIGHT = 32;
const FONT_LIST_HEIGHT = 280;
const FONT_LIST_OVERSCAN = 6;

// ═══════════════════════════════════════════════════════════
// Aegis CSS variable helpers — inline style equivalents of
// the token system used throughout the rest of the app.
// These are used as style objects so the font-changing stacks
// can be applied via `fontFamily` on the same element.
// ═══════════════════════════════════════════════════════════
const vars = {
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
  accentBg: "var(--control-active-bg, rgb(var(--aegis-primary) / 0.12))",
} as const;

export type FontFamily = string;

interface FontSelectorProps {
  value: FontFamily;
  onChange: (value: FontFamily) => void;
  label: string;
  hint: string;
  defaultFont: FontFamily;
  preview?: React.ReactNode;
}

export function FontSelector({
  value,
  onChange,
  label,
  hint,
  defaultFont,
  preview,
}: FontSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [fonts, setFonts] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterFonts(fonts, search), [fonts, search]);
  const visibleStart = Math.max(
    0,
    Math.floor(scrollTop / FONT_ITEM_HEIGHT) - FONT_LIST_OVERSCAN,
  );
  const visibleEnd = Math.min(
    filtered.length,
    visibleStart +
      Math.ceil(FONT_LIST_HEIGHT / FONT_ITEM_HEIGHT) +
      FONT_LIST_OVERSCAN * 2,
  );
  const visibleFonts = filtered.slice(visibleStart, visibleEnd);
  const listHeight = Math.min(
    FONT_LIST_HEIGHT,
    filtered.length * FONT_ITEM_HEIGHT,
  );

  useEffect(() => {
    if (!open) return;
    if (loaded) return;
    let cancelled = false;
    loadSystemFonts().then((result) => {
      if (cancelled) return;
      setFonts(result);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setFocusedIndex(-1);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [search]);

  useEffect(() => {
    if (!open || !loaded) return;
    const target = parseFirstFontName(value).toLowerCase();
    const idx = filtered.findIndex((f) => f.toLowerCase() === target);
    if (idx >= 0) {
      setFocusedIndex(idx);
      requestAnimationFrame(() => scrollItemIntoView(idx));
    }
  }, [open, loaded, value, filtered]);

  const displayName = parseFirstFontName(value);

  const handleSelect = useCallback(
    (font: string) => {
      onChange(quoteFontName(font));
      setOpen(false);
      setSearch("");
    },
    [onChange],
  );

  function scrollItemIntoView(index: number) {
    const list = listRef.current;
    if (!list) return;
    const itemTop = index * FONT_ITEM_HEIGHT;
    const itemBottom = itemTop + FONT_ITEM_HEIGHT;
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop;
      return;
    }
    if (itemBottom > list.scrollTop + FONT_LIST_HEIGHT) {
      list.scrollTop = itemBottom - FONT_LIST_HEIGHT;
    }
  }

  const isSelected = useCallback(
    (font: string) =>
      parseFirstFontName(value).toLowerCase() === font.toLowerCase(),
    [value],
  );

  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 8,
        border: `1px solid ${vars.border}`,
        background: vars.elevated,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: vars.text,
              }}
            >
              {label}
            </span>
            <button
              type="button"
              onClick={() => onChange(defaultFont)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                color: vars.textDim,
                fontSize: 11,
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              <RotateCcw size={11} />
              {t("common.retry", "Reset")}
            </button>
          </div>
          <span
            style={{
              fontSize: 11.5,
              color: vars.textDim,
              lineHeight: 1.45,
            }}
          >
            {hint}
          </span>
        </div>

        <Popover.Root
          open={open}
          onOpenChange={(v: boolean) => {
            setOpen(v);
            if (!v) setSearch("");
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              className="radix-select-trigger"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                height: 34,
                padding: "0 10px",
                borderRadius: 6,
                border: `1px solid ${vars.borderHover}`,
                background: vars.input,
                color: vars.text,
                fontSize: 13,
                cursor: "pointer",
                outline: "none",
              }}
            >
              <span
                style={{
                  flex: 1,
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: value,
                }}
              >
                {displayName || t("settings.fontNotAvailable", "Not available")}
              </span>
              <ChevronDown
                size={13}
                strokeWidth={2}
                color={vars.textDim}
                style={{ flexShrink: 0 }}
              />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="font-selector-content"
              sideOffset={4}
              align="start"
              onOpenAutoFocus={(e: Event) => e.preventDefault()}
              style={{
                background: vars.card,
                border: `1px solid ${vars.borderHover}`,
                borderRadius: 8,
                boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                zIndex: 2000,
                width: "var(--radix-popover-trigger-width)",
                overflow: "hidden",
              }}
            >
              <div
                className="font-selector-search"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 10px",
                  borderBottom: `1px solid ${vars.border}`,
                }}
              >
                <Search size={13} strokeWidth={2} color={vars.textDim} />
                <input
                  ref={inputRef}
                  className="font-selector-search-input"
                  style={{
                    flex: 1,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: vars.text,
                    fontSize: 12.5,
                    fontFamily: "var(--font-ui)",
                  }}
                  placeholder={t("settings.fontSearch", "Search fonts…")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className="font-selector-clear"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 2,
                      color: vars.textDim,
                      borderRadius: 4,
                    }}
                    onClick={() => setSearch("")}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              <div
                ref={listRef}
                className="font-selector-list"
                role="listbox"
                aria-label={label}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                style={{
                  padding: 4,
                  maxHeight: FONT_LIST_HEIGHT,
                  overflowY: "auto",
                  position: "relative",
                  ...(filtered.length > 0 ? { height: listHeight } : {}),
                }}
              >
                {!loaded && (
                  <div
                    className="font-selector-empty"
                    style={{
                      padding: "12px 10px",
                      fontSize: 12,
                      color: vars.textDim,
                      textAlign: "center",
                    }}
                  >
                    {t("settings.fontLoading", "Loading…")}
                  </div>
                )}
                {loaded && filtered.length === 0 && !search && (
                  <div
                    className="font-selector-empty"
                    style={{
                      padding: "12px 10px",
                      fontSize: 12,
                      color: vars.textDim,
                      textAlign: "center",
                    }}
                  >
                    {t("settings.fontNotAvailable", "Not available")}
                  </div>
                )}
                {loaded && search && filtered.length === 0 && (
                  <div
                    className="font-selector-empty"
                    style={{
                      padding: "12px 10px",
                      fontSize: 12,
                      color: vars.textDim,
                      textAlign: "center",
                    }}
                  >
                    {t("settings.fontNoResults", "No results")}
                  </div>
                )}
                {filtered.length > 0 && (
                  <div
                    className="font-selector-virtual-spacer"
                    style={{
                      position: "relative",
                      height: filtered.length * FONT_ITEM_HEIGHT,
                    }}
                  >
                    {visibleFonts.map((font, offset) => {
                      const index = visibleStart + offset;
                      const selected = isSelected(font);
                      // Determine background color based on hover / selection
                      let bg: string | undefined;
                      if (focusedIndex === index) {
                        bg = vars.hover;
                      } else if (selected) {
                        bg = vars.accentBg;
                      }
                      return (
                        <button
                          key={font}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className="font-selector-item"
                          tabIndex={-1}
                          style={{
                            position: "absolute",
                            left: 0,
                            width: "100%",
                            top: index * FONT_ITEM_HEIGHT,
                            height: FONT_ITEM_HEIGHT,
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "6px 10px",
                            border: "none",
                            borderRadius: 6,
                            fontSize: 13,
                            fontFamily: selected ? font : undefined,
                            color: vars.text,
                            cursor: "pointer",
                            textAlign: "left",
                            outline: "none",
                            background: bg,
                          }}
                          onClick={() => handleSelect(font)}
                          onMouseEnter={() => setFocusedIndex(index)}
                        >
                          <span
                            className="font-selector-item-name"
                            style={{
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {font}
                          </span>
                          {selected && (
                            <Check
                              size={12}
                              strokeWidth={2.5}
                              color={vars.primary}
                              style={{ flexShrink: 0 }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {preview}
      </div>
    </div>
  );
}
