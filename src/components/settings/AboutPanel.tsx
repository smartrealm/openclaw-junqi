import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Download, RefreshCw, Star } from "lucide-react";
import { APP_VERSION } from '@/version';

export function AboutPanel() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");

  const checkForUpdate = async (silent = false) => {
    setChecking(true);
    if (!silent) setUpdateMessage("");
    try {
      const nextUpdate = await check();
      setUpdate(nextUpdate);
      setUpdateMessage(nextUpdate
        ? t("about.updateAvailable", "发现新版本 v{{version}}", { version: nextUpdate.version })
        : t("about.upToDate", "当前已是最新版本"));
    } catch (error) {
      if (!silent) {
        setUpdateMessage(t("about.updateCheckFailed", "检查更新失败：{{error}}", { error: String(error) }));
      }
    } finally {
      setChecking(false);
    }
  };

  const installUpdate = async () => {
    if (!update || installing) return;
    setInstalling(true);
    setProgress(0);
    setUpdateMessage(t("about.downloadingUpdate", "正在下载更新…"));
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress(total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null);
        }
        if (event.event === "Finished") {
          setProgress(100);
          setUpdateMessage(t("about.restartingForUpdate", "更新安装完成，正在重启…"));
        }
      });
      await relaunch();
    } catch (error) {
      setUpdateMessage(t("about.updateInstallFailed", "更新失败：{{error}}", { error: String(error) }));
      setInstalling(false);
    }
  };

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(APP_VERSION));
    void checkForUpdate(true);
    // Check once whenever the About panel is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-aegis-primary/20 to-aegis-primary/5 border border-aegis-primary/20 flex items-center justify-center">
        <Star size={28} className="text-aegis-primary" />
      </div>
      <div className="text-center">
        <h2 className="text-[16px] font-bold text-aegis-text">JunQi Desktop</h2>
        <p className="text-[12px] text-aegis-text-dim mt-1">v{version || APP_VERSION}</p>
      </div>
      <p className="text-[12px] text-aegis-text-muted max-w-[320px] text-center leading-relaxed">
        {t("about.description", "AI-powered desktop assistant by 陕西浚启智境科技有限公司")}
      </p>
      <div className="flex w-full max-w-[320px] flex-col items-center gap-2 border-t border-aegis-border/60 pt-4">
        {updateMessage && (
          <p className="text-center text-[12px] text-aegis-text-muted">{updateMessage}</p>
        )}
        {installing && progress !== null && (
          <div className="h-1.5 w-full overflow-hidden rounded bg-aegis-border/60">
            <div className="h-full bg-aegis-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        )}
        {update ? (
          <button
            type="button"
            onClick={() => void installUpdate()}
            disabled={installing}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-aegis-primary px-4 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            <Download size={15} />
            {installing ? t("about.installingUpdate", "正在更新") : t("about.downloadUpdate", "下载并安装 v{{version}}", { version: update.version })}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void checkForUpdate()}
            disabled={checking}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-aegis-border px-4 text-[12px] font-medium text-aegis-text hover:bg-aegis-hover disabled:opacity-50"
          >
            <RefreshCw size={15} className={checking ? "animate-spin" : ""} />
            {checking ? t("about.checkingUpdate", "正在检查") : t("about.checkForUpdates", "检查更新")}
          </button>
        )}
      </div>
    </div>
  );
}
