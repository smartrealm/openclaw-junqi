import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, CheckCircle2, LoaderCircle, Upload, X, XCircle } from 'lucide-react';
import clsx from 'clsx';
import {
  MAX_SKILL_ARCHIVE_BYTES,
  openClawSkillsRuntime,
  type SkillArchiveUploadPhase,
} from '@/services/openclawSkillsRuntime';

interface SkillArchiveUploadPanelProps {
  connected: boolean;
  onInstalled: () => void | Promise<void>;
}

function suggestedSlug(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function phaseLabel(
  t: (key: string, defaultValue: string) => string,
  phase: SkillArchiveUploadPhase | null,
): string {
  if (phase === 'starting') return t('skills.uploadStarting', 'Preparing upload');
  if (phase === 'uploading') return t('skills.uploading', 'Uploading archive');
  if (phase === 'committing') return t('skills.uploadCommitting', 'Verifying archive');
  if (phase === 'installing') return t('skills.uploadInstalling', 'Installing skill');
  return '';
}

export function SkillArchiveUploadPanel({ connected, onInstalled }: SkillArchiveUploadPanelProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<SkillArchiveUploadPhase | null>(null);
  const [completedBytes, setCompletedBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const chooseFile = () => inputRef.current?.click();

  const clearFile = () => {
    if (busy) return;
    setFile(null);
    setSlug('');
    setCompletedBytes(0);
    setError(null);
    setSuccess(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setSlug(next ? suggestedSlug(next.name) : '');
    setCompletedBytes(0);
    setError(null);
    setSuccess(null);
  };

  const install = async () => {
    if (!file || busy || !connected) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setCompletedBytes(0);
    try {
      if (!/\.zip$/i.test(file.name)) {
        throw new Error(t('skills.uploadZipOnly', 'Choose a ZIP archive.'));
      }
      if (file.size > MAX_SKILL_ARCHIVE_BYTES) {
        throw new Error(t('skills.uploadTooLarge', 'Skill archive exceeds the OpenClaw upload limit.'));
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await openClawSkillsRuntime.installArchive({
        slug,
        bytes,
        force,
        onProgress: ({ phase: nextPhase, completedBytes: nextCompleted }) => {
          setPhase(nextPhase);
          setCompletedBytes(nextCompleted);
        },
      });
      setSuccess(result.message || t('skills.uploadDone', 'Skill installed.'));
      await onInstalled();
    } catch (reason) {
      setSuccess(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const progress = file && file.size > 0
    ? Math.min(100, Math.round((completedBytes / file.size) * 100))
    : 0;

  return (
    <section
      className="mb-5 overflow-hidden rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)]"
      aria-label={t('skills.uploadTitle', 'Upload skill archive')}
    >
      <div className="flex items-start gap-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] px-4 py-3">
        <Archive size={16} className="mt-0.5 shrink-0 text-aegis-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold text-aegis-text">{t('skills.uploadTitle', 'Upload skill archive')}</h2>
          <p className="mt-0.5 text-[10.5px] text-aegis-text-dim">{t('skills.uploadHint', 'Send a ZIP archive through the selected OpenClaw Gateway.')}</p>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <input ref={inputRef} type="file" accept=".zip,application/zip" onChange={onFileChange} className="hidden" />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={chooseFile}
            disabled={busy || !connected}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-aegis-primary/25 bg-aegis-primary/[0.06] px-3 py-2 text-[11px] font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/[0.11] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload size={13} aria-hidden="true" />
            <span className="max-w-[260px] truncate">{file?.name || t('skills.chooseArchive', 'Choose ZIP archive')}</span>
          </button>
          {file && (
            <>
              <span className="text-[10px] text-aegis-text-dim">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={clearFile}
                disabled={busy}
                title={t('skills.clearArchive', 'Clear selected archive')}
                aria-label={t('skills.clearArchive', 'Clear selected archive')}
                className="grid size-7 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-danger/[0.08] hover:text-aegis-danger disabled:opacity-50"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="min-w-0">
            <span className="mb-1 block text-[10px] font-medium text-aegis-text-dim">{t('skills.uploadSlug', 'Skill slug')}</span>
            <input
              value={slug}
              onChange={(event) => { setSlug(event.target.value); setError(null); setSuccess(null); }}
              disabled={busy}
              placeholder={t('skills.uploadSlugPlaceholder', 'skill-name')}
              spellCheck={false}
              className="w-full rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] bg-aegis-bg px-2.5 py-2 font-mono text-[11px] text-aegis-text outline-none transition-colors placeholder:text-aegis-text-dim focus:border-aegis-primary/40 disabled:opacity-60"
            />
          </label>
          <label className="inline-flex items-center gap-2 pb-2 text-[10.5px] text-aegis-text-secondary">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
              disabled={busy}
              className="size-3.5 accent-[rgb(var(--aegis-primary))]"
            />
            {t('skills.uploadForce', 'Replace existing skill')}
          </label>
        </div>

        {busy && file && (
          <div className="space-y-1.5" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-2 text-[10px] text-aegis-text-dim">
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                {phaseLabel(t, phase)}
              </span>
              <span className="font-mono tabular-nums">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[rgb(var(--aegis-overlay)/0.08)]">
              <div className="h-full rounded-full bg-aegis-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 border-s-2 border-aegis-danger/60 bg-aegis-danger/[0.04] px-3 py-2 text-[10.5px] text-aegis-text-secondary" role="alert">
            <XCircle size={13} className="mt-0.5 shrink-0 text-aegis-danger" aria-hidden="true" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 border-s-2 border-aegis-success/60 bg-aegis-success/[0.04] px-3 py-2 text-[10.5px] text-aegis-text-secondary" role="status">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-aegis-success" aria-hidden="true" />
            <span className="min-w-0 break-words">{success}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-[9.5px] text-aegis-text-dim">
            {t('skills.uploadLimit', 'ZIP only, up to {{size}}.', { size: formatBytes(MAX_SKILL_ARCHIVE_BYTES) })}
          </span>
          <button
            type="button"
            onClick={() => void install()}
            disabled={!file || !slug.trim() || busy || !connected}
            className={clsx(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-semibold transition-colors',
              'bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45',
            )}
          >
            <Upload size={13} aria-hidden="true" />
            {t('skills.uploadInstall', 'Upload and install')}
          </button>
        </div>
      </div>
    </section>
  );
}
