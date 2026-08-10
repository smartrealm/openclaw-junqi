// ═══════════════════════════════════════════════════════════
// GatewayErrorScreen —— OpenClaw Gateway 启动失败时的诊断与恢复页。
// 用户无需退出应用即可查看依据并执行恢复操作。
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  RefreshCw,
  FileText,
  ChevronDown,
  ChevronUp,
  Terminal,
  FolderOpen,
} from 'lucide-react';
import { GatewaySelfRescuePanel } from '@/components/GatewaySelfRescuePanel';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { validateActiveOpenclawConfig } from '@/services/openclawConfigRuntime';
import { openRuntimeDataDirectory } from '@/services/runtimeDataDirectory';
import { useGatewayProcessRecovery } from '@/hooks/useGatewayProcessRecovery';

interface GatewayErrorScreenProps {
  error: string;
  logs?: { stdout: string; stderr: string };
  retrying?: boolean;
  onRetry: () => void;
  /** Called when gateway comes back up so App.tsx can dismiss this screen */
  onRecovered?: () => void;
}

type ErrorCategory =
  | 'config-invalid'
  | 'config-schema-invalid'
  | 'port-in-use'
  | 'timeout'
  | 'not-found'
  | 'crash'
  | 'unknown';

function categorize(error: string): ErrorCategory {
  if (error.includes('CONFIG_SCHEMA_INVALID')) return 'config-schema-invalid';
  if (error.includes('CONFIG_INVALID')) return 'config-invalid';
  if (error.includes('already in use') || error.includes('EADDRINUSE')) return 'port-in-use';
  if (error.includes('Timeout waiting')) return 'timeout';
  if (error.includes('not found') || error.includes('NODE_NOT_FOUND') || error.includes('openclaw.mjs')) return 'not-found';
  if (error.includes('code 1') || error.includes('crashed')) return 'crash';
  return 'unknown';
}

export function GatewayErrorScreen({
  error,
  logs,
  retrying = false,
  onRetry,
  onRecovered,
}: GatewayErrorScreenProps) {
  const { t } = useTranslation();
  const category = categorize(error);
  const meta = {
    'config-invalid': {
      title: t('gatewayError.configInvalid.title'),
      hint: t('gatewayError.configInvalid.hint'),
      color: 'text-aegis-warning',
    },
    'config-schema-invalid': {
      title: t('gatewayError.configSchemaInvalid.title'),
      hint: t('gatewayError.configSchemaInvalid.hint'),
      color: 'text-aegis-warning',
    },
    'port-in-use': {
      title: t('gatewayError.portInUse.title'),
      hint: t('gatewayError.portInUse.hint'),
      color: 'text-aegis-warning',
    },
    timeout: {
      title: t('gatewayError.timeout.title'),
      hint: t('gatewayError.timeout.hint'),
      color: 'text-aegis-warning',
    },
    'not-found': {
      title: t('gatewayError.notFound.title'),
      hint: t('gatewayError.notFound.hint'),
      color: 'text-aegis-danger',
    },
    crash: {
      title: t('gatewayError.crash.title'),
      hint: t('gatewayError.crash.hint'),
      color: 'text-aegis-danger',
    },
    unknown: {
      title: t('gatewayError.unknown.title'),
      hint: t('gatewayError.unknown.hint'),
      color: 'text-aegis-danger',
    },
  }[category];
  const [showLogs, setShowLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const [configValidation, setConfigValidation] = useState<{
    valid: boolean;
    path: string;
    exists: boolean;
    error?: string;
  } | null>(null);
  // Gateway 不可用时只读取配置诊断，不能绕过 Gateway 覆盖 OpenClaw 配置。
  useEffect(() => {
    void validateActiveOpenclawConfig().then(setConfigValidation).catch(() => setConfigValidation(null));
  }, []);

  useGatewayProcessRecovery(onRecovered);

  const handleOpenLogFile = useCallback(() => {
    void openRuntimeDataDirectory();
  }, []);

  const errorBody = error
    .replace(/^CONFIG_SCHEMA_INVALID\n/, '')
    .replace(/^CONFIG_INVALID\n/, '')
    .split('\n')
    .filter(Boolean);

  const combinedLogs = [
    logs?.stdout?.trim(),
    logs?.stderr?.trim(),
  ]
    .filter(Boolean)
    .join('\n\n--- stderr ---\n\n');

  useEffect(() => {
    if (retrying) setShowLogs(true);
  }, [retrying]);

  useEffect(() => {
    if (!showLogs || !logsContainerRef.current) return;
    logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [combinedLogs, showLogs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-aegis-bg-solid">
      <div className="relative mx-4 max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-lg border border-aegis-border bg-aegis-card-solid shadow-popover">
        <div className="h-px bg-aegis-danger/40" />

        <div className="max-h-[calc(92vh-4px)] overflow-y-auto p-6">
          {/* 标题区只保留错误语义，不增加装饰背景。 */}
          <div className="flex items-start gap-4 mb-5">
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-aegis-danger/10 border border-aegis-danger/20 flex items-center justify-center">
              <AlertTriangle className={`w-6 h-6 ${meta.color}`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-aegis-text mb-1">
                {meta.title}
              </h2>
              <p className="text-sm text-aegis-text-muted leading-relaxed">
                {meta.hint}
              </p>
            </div>
          </div>

          {/* Config validation badge */}
          {configValidation && !configValidation.valid && (
            <div className="mb-4 p-3 rounded-lg bg-aegis-warning/10 border border-aegis-warning/20 flex items-start gap-2">
              <FileText className="w-4 h-4 text-aegis-warning mt-0.5 flex-shrink-0" />
              <div className="text-xs text-aegis-warning leading-relaxed">
                <span className="font-semibold">{t('gatewayError.invalidConfigLabel')}</span>{' '}
                <span className="font-mono text-aegis-warning break-all">{configValidation.path}</span>
                {configValidation.error && (
                  <div className="mt-1 text-aegis-warning/80">{configValidation.error}</div>
                )}
              </div>
            </div>
          )}

          {/* Error detail lines */}
          <div className="mb-4 p-3 rounded-lg bg-aegis-bg border border-aegis-border">
            <div className="flex items-center gap-1.5 mb-2">
              <Terminal className="w-3.5 h-3.5 text-aegis-text-muted" />
              <span className="text-xs font-semibold text-aegis-text-muted uppercase tracking-wider">Error Detail</span>
            </div>
            <div className="space-y-0.5">
              {errorBody.map((line, i) => (
                <p key={i} className="text-xs font-mono text-aegis-text-secondary leading-relaxed break-all">
                  {line}
                </p>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={onRetry}
                disabled={retrying}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-aegis-primary text-aegis-btn-primary-text text-sm font-medium hover:bg-aegis-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {retrying
                  ? <LoadingIndicator size={16} />
                  : <RefreshCw className="w-4 h-4" />}
              {retrying ? t('gatewayError.actions.retrying') : t('gatewayError.actions.retryGateway')}
              </button>

            <button
              onClick={handleOpenLogFile}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-aegis-card text-aegis-text-secondary text-sm font-medium hover:bg-aegis-hover hover:text-aegis-text border border-aegis-border transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              {t('gatewayError.actions.openLogFile')}
            </button>

          </div>

          <GatewaySelfRescuePanel
            className="mb-4"
            variant="full"
            connected={false}
            busy={retrying}
            progressMessage={retrying ? t('gatewayError.actions.retrying') : null}
            progressPercent={retrying ? 35 : null}
            primaryActionLabel={retrying ? t('gatewayError.actions.retrying') : t('gatewayError.actions.retryGateway')}
            onPrimaryAction={onRetry}
            error={error}
            logs={combinedLogs}
          />

          {/* Collapsible gateway logs */}
          {combinedLogs && (
            <div>
              <button
                onClick={() => setShowLogs((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-aegis-text-muted hover:text-aegis-text-secondary transition-colors mb-2"
              >
                {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showLogs ? t('gatewayError.actions.hideLogs') : t('gatewayError.actions.showLogs')}
              </button>
              {showLogs && (
                <div
                  ref={logsContainerRef}
                  className="p-3 rounded-lg bg-black/40 border border-aegis-border max-h-48 overflow-y-auto"
                >
                  <pre className="text-xs font-mono text-aegis-text-muted whitespace-pre-wrap break-all leading-relaxed">
                    {combinedLogs}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
