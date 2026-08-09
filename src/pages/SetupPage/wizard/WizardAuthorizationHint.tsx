import { Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OpenClawWizardStep } from "@/services/openclawWizard";

async function openWizardExternalUrl(value?: string): Promise<void> {
  if (!value) return;
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(value);
  } catch {
    // 授权地址由 Gateway 提供；桌面 Shell 不可用时不能伪造已打开或已授权状态。
  }
}

export function WizardAuthorizationHint({
  externalUrl,
  deviceCode,
}: Pick<OpenClawWizardStep, "externalUrl" | "deviceCode">) {
  const { t } = useTranslation();
  if (!externalUrl && !deviceCode) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-aegis-border pt-4">
      <div className="min-w-0 flex-1 space-y-2">
        {deviceCode && (
          <div className="rounded-md border border-aegis-border bg-aegis-surface px-3 py-2">
            <p className="text-xs text-aegis-text-muted">
              {deviceCode.message || t("setup.wizard.deviceCodeHint")}
            </p>
            <code className="mt-1 block break-all text-sm font-semibold text-aegis-text">{deviceCode.code}</code>
          </div>
        )}
        {externalUrl && (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(externalUrl).catch(() => undefined)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"
            >
              <Copy size={13} />{t("common.copy")}
            </button>
            <button
              type="button"
              onClick={() => void openWizardExternalUrl(externalUrl)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"
            >
              <ExternalLink size={13} />{t("setup.wizard.openInBrowser")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
