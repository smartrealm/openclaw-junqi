import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { TFunction } from "i18next";
import type { OpenClawWizardOption } from "@/services/openclawWizard";

const SEARCHABLE_OPTION_COUNT = 7;

export interface FilteredWizardOption {
  option: OpenClawWizardOption;
  originalIndex: number;
}

export function shouldSearchWizardOptions(options: readonly OpenClawWizardOption[]): boolean {
  return options.length >= SEARCHABLE_OPTION_COUNT;
}

function optionSearchText(option: OpenClawWizardOption): string {
  const value = typeof option.value === "string" ? option.value : "";
  return [option.label, option.hint ?? "", value].join("\n").toLocaleLowerCase();
}

export function filterWizardOptions(
  options: readonly OpenClawWizardOption[],
  query: string,
): FilteredWizardOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return options.flatMap((option, originalIndex) => (
    !normalizedQuery || optionSearchText(option).includes(normalizedQuery)
      ? [{ option, originalIndex }]
      : []
  ));
}

export function WizardOptionSearch({
  stepId,
  options,
  t,
  renderOptions,
}: {
  stepId: string;
  options: readonly OpenClawWizardOption[];
  t: TFunction;
  renderOptions: (options: readonly FilteredWizardOption[]) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const searchable = shouldSearchWizardOptions(options);
  const filteredOptions = useMemo(
    () => filterWizardOptions(options, searchable ? query : ""),
    [options, query, searchable],
  );

  useEffect(() => {
    setQuery("");
  }, [stepId]);

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="relative">
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-aegis-text-dim"
          />
          <input
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("setup.wizard.searchOptions")}
            placeholder={t("setup.wizard.searchOptions")}
            className="h-10 w-full rounded-lg border border-aegis-border bg-aegis-input ps-10 pe-10 text-sm text-aegis-text outline-none transition-colors placeholder:text-aegis-text-dim focus:border-aegis-primary focus-visible:ring-2 focus-visible:ring-aegis-primary/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("setup.wizard.clearSearch")}
              className="absolute end-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40"
            >
              <X aria-hidden="true" size={15} />
            </button>
          )}
          <span className="sr-only" aria-live="polite">
            {t("setup.wizard.searchResultCount", { count: filteredOptions.length })}
          </span>
        </div>
      )}

      {filteredOptions.length > 0 ? (
        <div className={searchable ? "max-h-[min(52vh,32rem)] overflow-y-auto pe-1" : undefined}>
          {renderOptions(filteredOptions)}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-aegis-border px-4 py-8 text-center text-sm text-aegis-text-muted">
          {t(searchable ? "setup.wizard.noMatchingOptions" : "setup.wizard.noOptionsAvailable")}
        </div>
      )}
    </div>
  );
}
