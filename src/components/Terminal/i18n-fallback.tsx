// Bridge so junqi-verbatim components calling useI18n() work
// in our useTranslation() world.
import { useTranslation } from "react-i18next";
export function useI18n() {
  const { t } = useTranslation();
  return { t };
}
