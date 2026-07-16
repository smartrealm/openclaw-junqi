import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { CheckCircle2, FolderOpen, Loader2, Package, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/shared/GlassCard';

interface StorageSetupStatus {
  configured: boolean;
  npmCacheDir: string | null;
}

export function NpmCacheSettingsPanel() {
  const { t } = useTranslation();
  const [configured, setConfigured] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [draftPath, setDraftPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void invoke<StorageSetupStatus>('get_storage_setup_status')
      .then((status) => {
        if (!active) return;
        setConfigured(status.configured);
        const customPath = status.npmCacheDir ?? '';
        setSavedPath(customPath);
        setDraftPath(customPath);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const chooseDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('storage.npmCacheChoose', '选择 npm 下载缓存目录'),
    });
    if (typeof selected !== 'string') return;
    setDraftPath(selected);
    setMessage(null);
    setError(null);
  };

  const save = async () => {
    const nextPath = draftPath.trim();
    if (!configured || !nextPath || saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await invoke<string>('update_npm_cache_directory', {
        npmCacheDir: nextPath,
      });
      setSavedPath(updated);
      setDraftPath(updated);
      setMessage(t('storage.npmCacheSaved', 'npm 下载缓存位置已更新'));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!configured || saving || !savedPath) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await invoke<string>('update_npm_cache_directory', { npmCacheDir: '' });
      setSavedPath('');
      setDraftPath('');
      setMessage(t('storage.npmCacheDefaultRestored', '已恢复 npm 默认缓存位置'));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  const unchanged = draftPath.trim() === savedPath;

  return (
    <GlassCard delay={0.2}>
      <div className="mb-1 flex items-center gap-2">
        <Package size={16} className="text-aegis-primary" />
        <h3 className="text-[14px] font-semibold text-aegis-text">
          {t('storage.npmCacheSettingsTitle', 'npm 下载缓存')}
        </h3>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-aegis-text-dim/70">
        {t('storage.npmCacheSettingsHint', '用于后续 npm 下载和安装；与系统或托管 Node.js 是否已安装无关。')}
      </p>

      <div className="flex items-center gap-2">
        <input
          value={draftPath}
          onChange={(event) => {
            setDraftPath(event.target.value);
            setMessage(null);
            setError(null);
          }}
          disabled={loading || !configured || saving}
          aria-label={t('storage.npmCacheLocation', 'npm 下载缓存')}
          placeholder={t('storage.npmCacheSystemDefault', '使用 npm 系统默认位置')}
          className="min-w-0 flex-1 rounded-md border border-aegis-border bg-aegis-surface px-3 py-2 font-mono text-[11px] text-aegis-text outline-none focus:border-aegis-primary disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void chooseDirectory()}
          disabled={loading || !configured || saving}
          title={t('storage.npmCacheChoose', '选择 npm 下载缓存目录')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface disabled:opacity-50"
        >
          <FolderOpen size={15} />
        </button>
        <button
          type="button"
          onClick={() => void resetToDefault()}
          disabled={loading || !configured || saving || !savedPath}
          title={t('storage.npmCacheUseDefault', '恢复 npm 默认缓存位置')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-border text-aegis-text-secondary hover:bg-aegis-surface disabled:opacity-50"
        >
          <RotateCcw size={15} />
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || !configured || saving || !draftPath.trim() || unchanged}
          className="inline-flex h-9 min-w-[88px] items-center justify-center gap-1.5 rounded-md bg-aegis-primary px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          {saving ? t('storage.npmCacheSaving', '保存中…') : t('storage.npmCacheSave', '保存位置')}
        </button>
      </div>

      {!loading && !configured && (
        <p className="mt-3 text-[11px] text-aegis-warning">
          {t('storage.npmCacheSetupRequired', '请先完成存储初始化，再修改 npm 下载缓存。')}
        </p>
      )}
      {message && <p className="mt-3 text-[11px] text-aegis-success">{message}</p>}
      {error && <p className="mt-3 break-all text-[11px] text-aegis-danger">{error}</p>}
    </GlassCard>
  );
}
