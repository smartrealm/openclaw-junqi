import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Search, ChevronDown, Check, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "react-i18next";
import { loadSystemFonts, parseFirstFontName, filterFonts, quoteFontName } from "@/utils/fonts";

interface FontSelectorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  defaultFont: string;
}

const FONT_ITEM_HEIGHT = 32;
const FONT_LIST_HEIGHT = 280;
const FONT_LIST_OVERSCAN = 6;

export function FontSelector({ value, onChange, label, defaultFont }: FontSelectorProps) {
  const { t } = useTranslation();
  const [fonts, setFonts] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSystemFonts().then(setFonts);
  }, []);

  const filtered = useMemo(
    () => (fonts.length ? filterFonts(fonts, query) : [value].filter(Boolean)),
    [fonts, query, value],
  );

  const selectedLabel = value ? parseFirstFontName(value) : defaultFont;

  const select = useCallback(
    (name: string) => {
      onChange(name);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-2">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-aegis-text-secondary">{label}</span>
          <Popover.Trigger asChild>
            <button className="flex items-center gap-1.5 rounded-lg border border-aegis-border bg-aegis-input px-3 py-1.5 text-[12px] text-aegis-text hover:border-aegis-border-hover transition-colors max-w-[200px]">
              <span className="truncate">{selectedLabel}</span>
              <ChevronDown size={12} className="text-aegis-text-muted shrink-0" />
            </button>
          </Popover.Trigger>
        </div>

        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={4}
            className="z-50 rounded-xl border border-aegis-border bg-aegis-card shadow-lg w-[320px]"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <div className="flex items-center gap-2 border-b border-aegis-border px-3 py-2">
              <Search size={13} className="text-aegis-text-muted shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("font.search", "Search fonts...")}
                className="flex-1 border-none outline-none bg-transparent text-[12px] text-aegis-text placeholder:text-aegis-text-dim"
              />
              {query && (
                <button onClick={() => setQuery("")} className="p-0.5 text-aegis-text-muted hover:text-aegis-text">
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="overflow-y-auto p-1" style={{ maxHeight: FONT_LIST_HEIGHT }}>
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-[12px] text-aegis-text-muted text-center">
                  {fonts.length === 0
                    ? t("font.loading", "Loading system fonts...")
                    : t("font.noResults", "No matching fonts")}
                </div>
              ) : (
                filtered.slice(0, Math.ceil(FONT_LIST_HEIGHT / FONT_ITEM_HEIGHT) + FONT_LIST_OVERSCAN).map((fontName) => {
                  const isSelected = value === fontName;
                  return (
                    <button
                      key={fontName}
                      onClick={() => select(fontName)}
                      className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[12px] text-left hover:bg-aegis-hover transition-colors"
                      style={{ height: FONT_ITEM_HEIGHT, fontFamily: quoteFontName(fontName) }}
                    >
                      <span className="truncate select-none">{parseFirstFontName(fontName)}</span>
                      {isSelected && <Check size={13} className="text-aegis-primary shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
