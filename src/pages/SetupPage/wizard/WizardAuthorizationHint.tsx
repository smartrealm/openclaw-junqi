import { Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QrCodeDisplay } from "@/components/shared/QrCodeDisplay";
import type { OpenClawWizardStep } from "@/services/openclawWizard";

const HTTPS_URL_PATTERN = /https:\/\/[^\s<>"'`]+/giu;

function isOneTimeAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.searchParams.get("user_code")?.trim());
  } catch {
    return false;
  }
}

export function resolveWizardAuthorizationUrl({
  externalUrl,
  message,
}: Pick<OpenClawWizardStep, "externalUrl" | "message">): string | undefined {
  if (externalUrl) return externalUrl;
  if (!message) return undefined;

  // 旧渠道插件可能只在当前 note 中返回一次性设备授权地址。仅投影带
  // `user_code` 的 HTTPS 地址，避免把后续说明页中的普通链接继续渲染为二维码。
  const candidates = Array.from(new Set(message.match(HTTPS_URL_PATTERN) ?? []))
    .filter(isOneTimeAuthorizationUrl);
  return candidates.length === 1 ? candidates[0] : undefined;
}

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
  step,
}: {
  step: Pick<OpenClawWizardStep, "externalUrl" | "deviceCode" | "message">;
}) {
  const { t } = useTranslation();
  const { externalUrl, deviceCode, message } = step;
  const authorizationUrl = resolveWizardAuthorizationUrl({ externalUrl, message });

  if (!authorizationUrl && !deviceCode) return null;

  return (
    <div
      data-wizard-authorization="true"
      className="mt-4 grid gap-4 border-t border-aegis-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="min-w-0 flex-1 space-y-2">
        {deviceCode && (
          <div className="rounded-md border border-aegis-border bg-aegis-surface px-3 py-2">
            <p className="text-xs text-aegis-text-muted">
              {deviceCode.message || t("setup.wizard.deviceCodeHint")}
            </p>
            <code className="mt-1 block break-all text-sm font-semibold text-aegis-text">{deviceCode.code}</code>
          </div>
        )}
        {authorizationUrl && (
          <div className="space-y-3">
            <p className="text-xs leading-5 text-aegis-text-muted">
              {t("setup.wizard.scanQrHint")}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(authorizationUrl).catch(() => undefined)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"
              >
                <Copy size={13} />{t("common.copy")}
              </button>
              <button
                type="button"
                onClick={() => void openWizardExternalUrl(authorizationUrl)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"
              >
                <ExternalLink size={13} />{t("setup.wizard.openInBrowser")}
              </button>
            </div>
            <p className="text-xs leading-5 text-aegis-text-secondary">
              {t("setup.wizard.authorizationContinueHint")}
            </p>
          </div>
        )}
      </div>
      {authorizationUrl && (
        <div data-wizard-authorization-qr="true">
          <QrCodeDisplay
            content={authorizationUrl}
            alt={t("setup.wizard.qrAlt")}
            className="h-[184px] w-[184px]"
          />
        </div>
      )}
    </div>
  );
}
