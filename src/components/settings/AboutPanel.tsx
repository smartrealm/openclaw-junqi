import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { Star } from "lucide-react";
import { APP_VERSION } from '@/version';

export function AboutPanel() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(APP_VERSION));
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
    </div>
  );
}
