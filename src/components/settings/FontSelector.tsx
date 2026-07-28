import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, CircleX } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "react-i18next";
import {
  buildFontStack,
  filterFonts,
  loadSystemFontCatalog,
  parseFirstFontName,
  type FontCatalogSource,
  type FontRole,
} from "@/utils/fonts";

interface FontSelectorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  description?: string;
  defaultLabel: string;
  role: FontRole;
}
const ITEM_HEIGHT = 34;
const LIST_HEIGHT = 272;
const OVERSCAN = 5;

export function FontSelector({
  value,
  onChange,
  label,
  description,
  defaultLabel,
  role,
}: FontSelectorProps) {
  const { t } = useTranslation();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fonts, setFonts] = useState<string[]>([]);
  const [catalogSource, setCatalogSource] = useState<FontCatalogSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const selectedName = parseFirstFontName(value);
  const [draft, setDraft] = useState(selectedName);

  useEffect(() => {
    if (selectedName !== draft) setDraft(selectedName);
  }, [draft, selectedName]);

  const ensureFonts = useCallback(() => {
    if (catalogSource || loading) return;
    setLoading(true);
    void loadSystemFontCatalog().then((catalog) => {
      setFonts(catalog.fonts);
      setCatalogSource(catalog.source);
      setLoading(false);
    });
  }, [catalogSource, loading]);

  const matchingFonts = useMemo(
    () => filtering ? filterFonts(fonts, draft) : fonts,
    [draft, filtering, fonts],
  );
  const visibleFonts = useMemo(() => {
    if (!selectedName || matchingFonts.includes(selectedName)) return matchingFonts;
    return [selectedName, ...matchingFonts];
  }, [matchingFonts, selectedName]);
  const options = useMemo(
    () => {
      const fontOptions = visibleFonts.map((name) => ({ name, label: name }));
      return filtering && draft.trim()
        ? fontOptions
        : [{ name: "", label: defaultLabel }, ...fontOptions];
    },
    [defaultLabel, draft, filtering, visibleFonts],
  );

  useEffect(() => {
    const selectedIndex = options.findIndex((option) => option.name === selectedName);
    setHighlightedIndex(Math.max(selectedIndex, 0));
    setScrollTop(0);
  }, [options, selectedName]);

  const commit = useCallback((name: string) => {
    const next = buildFontStack(name, role);
    setDraft(parseFirstFontName(next));
    setFiltering(false);
    onChange(next);
  }, [onChange, role]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    options.length,
    Math.ceil((scrollTop + LIST_HEIGHT) / ITEM_HEIGHT) + OVERSCAN,
  );
  const renderedOptions = options.slice(startIndex, endIndex);

  const moveHighlight = (delta: number) => {
    setHighlightedIndex((current) => {
      const next = Math.min(Math.max(current + delta, 0), options.length - 1);
      const viewport = document.getElementById(listboxId);
      if (viewport) {
        const itemTop = next * ITEM_HEIGHT;
        if (itemTop < viewport.scrollTop) viewport.scrollTop = itemTop;
        else if (itemTop + ITEM_HEIGHT > viewport.scrollTop + LIST_HEIGHT) {
          viewport.scrollTop = itemTop + ITEM_HEIGHT - LIST_HEIGHT;
        }
      }
      return next;
    });
  };

  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] sm:items-center">
      <div className="min-w-0">
        <label className="text-[13px] font-medium text-aegis-text">{label}</label>
        {description && <p className="mt-1 text-[11px] leading-relaxed text-aegis-text-dim">{description}</p>}
      </div>
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            ensureFonts();
            setFiltering(false);
            setHighlightedIndex(Math.max(options.findIndex((option) => option.name === selectedName), 0));
          }
        }}
      >
        <Popover.Anchor asChild>
          <div className="relative">
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                setFiltering(true);
                setOpen(true);
                ensureFonts();
                onChange(buildFontStack(next, role));
              }}
              onFocus={() => {
                setOpen(true);
                setFiltering(false);
                ensureFonts();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveHighlight(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveHighlight(-1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  commit(options[highlightedIndex]?.name ?? draft);
                  setOpen(false);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(selectedName);
                  setFiltering(false);
                  setOpen(false);
                }
              }}
              placeholder={defaultLabel}
              spellCheck={false}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={open ? `${listboxId}-option-${highlightedIndex}` : undefined}
              className="h-9 w-full rounded-md border border-aegis-border bg-aegis-input px-3 pr-[68px] text-[12px] text-aegis-text outline-none transition-colors placeholder:text-aegis-text-dim focus:border-aegis-primary/55"
              style={{ fontFamily: value || undefined }}
            />
            <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
              {draft && (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    commit("");
                    setOpen(true);
                    inputRef.current?.focus();
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
                  title={t("font.clear", "Clear font selection")}
                  aria-label={t("font.clear", "Clear font selection")}
                >
                  <CircleX size={13} />
                </button>
              )}
              <Popover.Trigger asChild>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={ensureFonts}
                  className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
                  title={t("font.showFonts", "Show fonts")}
                  aria-label={t("font.showFonts", "Show fonts")}
                >
                  <ChevronsUpDown size={13} />
                </button>
              </Popover.Trigger>
            </div>
          </div>
        </Popover.Anchor>

        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={5}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="z-[2000] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border border-aegis-border bg-aegis-card shadow-[var(--shadow-popover)]"
          >
            <div
              id={listboxId}
              role="listbox"
              className="overflow-y-auto p-1"
              style={{ height: Math.min(LIST_HEIGHT, Math.max(ITEM_HEIGHT, options.length * ITEM_HEIGHT)) }}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div className="relative" style={{ height: options.length * ITEM_HEIGHT }}>
                {renderedOptions.map((option, offset) => {
                  const index = startIndex + offset;
                  const selected = option.name === selectedName;
                  const highlighted = index === highlightedIndex;
                  return (
                    <button
                      key={option.name || "__default__"}
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => {
                        commit(option.name);
                        setOpen(false);
                      }}
                      className={`absolute left-0 flex w-full items-center gap-2 rounded px-2.5 text-left text-[12px] transition-colors ${
                        highlighted ? "bg-aegis-hover text-aegis-text" : "text-aegis-text-muted"
                      }`}
                      style={{
                        top: index * ITEM_HEIGHT,
                        height: ITEM_HEIGHT,
                        fontFamily: option.name ? buildFontStack(option.name, role) : undefined,
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {selected && <Check size={13} className="shrink-0 text-aegis-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
            {loading && <div className="border-t border-aegis-border px-3 py-2 text-[10px] text-aegis-text-dim">{t("font.loading", "Loading system fonts...")}</div>}
            {!loading && visibleFonts.length === 0 && <div className="border-t border-aegis-border px-3 py-2 text-[10px] text-aegis-text-dim">{t("font.noResults", "No matching fonts")}</div>}
            {catalogSource === "fallback" && <div className="border-t border-aegis-border px-3 py-2 text-[10px] text-aegis-text-dim">{t("font.fallback", "System font list unavailable; showing common fonts")}</div>}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
