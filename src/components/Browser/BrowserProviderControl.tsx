import { AlertCircle, CheckCircle2, Globe2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useBrowserRuntimeStatus, type NativeBrowserStatus } from '@/hooks/useBrowserRuntimeStatus';
import { findEgoLiteProbe, isEgoLiteReady } from '@/services/browser/browserProviders';

function statusKey(status: NativeBrowserStatus | 'notInstalled' | 'unsupported' | 'unknown'): string {
  return `browserProviders.status.${status}`;
}

export function BrowserProviderControl() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { probes, probeLoading, nativeStatus } = useBrowserRuntimeStatus();
  const egoProbe = findEgoLiteProbe(probes);
  const egoStatus = egoProbe?.status === 'available' && !isEgoLiteReady(egoProbe)
    ? 'notInstalled'
    : egoProbe?.status;
  const status = probeLoading ? 'checking' : nativeStatus === 'available' ? 'available' : egoStatus ?? nativeStatus;
  const label = status === 'available'
    ? t('browserProviders.openclawName')
    : t('browserProviders.openPanel');

  return (
    <button
      type="button"
      onClick={() => navigate('/tools')}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
      title={`${label}: ${t(statusKey(status))}`}
      aria-label={`${label}: ${t(statusKey(status))}`}
    >
      {status === 'checking' ? <RefreshCw size={11} className="animate-spin" /> : status === 'available' ? <CheckCircle2 size={11} className="text-aegis-success" /> : status === 'unsupported' || status === 'unavailable' ? <AlertCircle size={11} /> : <Globe2 size={11} />}
    </button>
  );
}
