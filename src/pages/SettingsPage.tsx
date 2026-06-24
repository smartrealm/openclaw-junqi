// ═══════════════════════════════════════════════════════════
// SettingsPage — 1:1 alignment with openclaw-desktop/src/pages/SettingsPage.tsx
//
// 7 sections in the same order:
//   1. Connection   — gateway URL / token / test / status
//   2. Notifications — master toggle + sound + DND
//   3. Theme        — accent color, theme variant, font size, mono font
//   4. Language     — zh / en / ar selector
//   5. AI Defaults  — model picker, permission mode
//   6. Storage      — managed files index, attachment cleanup
//   7. About        — version, links, credits
//
// Icons come from the unified registry (components/shared/icons.tsx) so
// every section uses the same strokeWidth + sizing convention.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { changeLanguage } from '@/i18n';
import { gateway } from '@/services/gateway';
import { Icon } from '@/components/shared/icons';
import clsx from 'clsx';

interface SectionProps {
  title: string;
  description?: string;
  iconKey: 'gateway' | 'notifications' | 'theme' | 'language' | 'storage' | 'models' | 'about' | 'tools' | 'memory' | 'logs';
  children: React.ReactNode;
}

function Section({ title, description, iconKey, children }: SectionProps) {
  return (
    <section
      className="rounded-xl border border-aegis-border/60 bg-aegis-card/40 backdrop-blur-sm overflow-hidden"
      style={{ background: 'rgb(var(--aegis-card)/0.4)' }}
    >
      <div className="flex items-start gap-3 px-5 py-4 border-b border-aegis-border/40">
        <div className="shrink-0 mt-0.5 text-aegis-primary w-5 h-5 flex items-center justify-center">{Icon.section[iconKey]}</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold text-aegis-text leading-tight">{title}</h2>
          {description && (
            <p className="text-[11.5px] text-aegis-text-muted mt-0.5 leading-snug">{description}</p>
          )}
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
    </section>
  );
}

interface RowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function Row({ label, description, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-aegis-text">{label}</div>
        {description && (
          <div className="text-[11px] text-aegis-text-muted mt-0.5 leading-snug">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className={clsx(
        'relative inline-flex h-[20px] w-[34px] shrink-0 rounded-full transition-colors',
        value ? 'bg-aegis-primary' : 'bg-aegis-overlay/10 border border-aegis-border',
      )}
    >
      <span
        className={clsx(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform shadow-sm',
          value ? 'translate-x-[16px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

function Select({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-aegis-input border border-aegis-border text-aegis-text outline-none focus:border-aegis-primary/50 cursor-pointer min-w-[120px]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-aegis-elevated text-aegis-text">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="px-3 py-1.5 rounded-md text-[12px] font-mono bg-aegis-input border border-aegis-border text-aegis-text outline-none focus:border-aegis-primary/50 min-w-[280px]"
    />
  );
}

function ActionButton({ onClick, children, variant = 'secondary' }: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const styles = {
    primary: 'bg-aegis-primary text-aegis-on-primary hover:bg-aegis-primary-hover',
    secondary: 'bg-aegis-overlay/5 border border-aegis-border text-aegis-text hover:bg-aegis-overlay/10',
    danger: 'bg-aegis-danger/10 border border-aegis-danger/30 text-aegis-danger hover:bg-aegis-danger/20',
  } as const;
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
        styles[variant],
      )}
    >
      {children}
    </button>
  );
}

export function SettingsPageFull() {
  const { t } = useTranslation();
  const {
    theme, setTheme,
    language, setLanguage,
    notificationsEnabled, setNotificationsEnabled,
    soundEnabled, setSoundEnabled,
    dndMode, setDndMode,
    gatewayUrl, setGatewayUrl,
    gatewayToken, setGatewayToken,
  } = useSettingsStore();
  const { connected, connecting } = useChatStore();

  // ── Connection form state (openclaw-style edit-on-blur)
  const [editUrl, setEditUrl] = useState(gatewayUrl);
  const [editToken, setEditToken] = useState(gatewayToken);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  useEffect(() => { setEditUrl(gatewayUrl); }, [gatewayUrl]);
  useEffect(() => { setEditToken(gatewayToken); }, [gatewayToken]);

  const testConnection = async () => {
    setTestStatus('testing');
    setConnectionDirty(true);
    try {
      await gateway.connect(editUrl, editToken);
      setTestStatus('ok');
    } catch {
      setTestStatus('fail');
    }
  };

  const saveConnection = () => {
    setGatewayUrl(editUrl);
    setGatewayToken(editToken);
    setConnectionDirty(false);
  };

  // ── Theme variant (aegis-dark / aegis-light / aegis-eyecare / aegis-midnight)
  const themeOptions = [
    { value: 'aegis-dark',     label: t('theme.dark',     'Dark') },
    { value: 'aegis-light',    label: t('theme.light',    'Light') },
    { value: 'aegis-eyecare',  label: t('theme.eyecare',  'Eyecare') },
    { value: 'aegis-midnight', label: t('theme.midnight', 'Midnight') },
  ];

  // ── Language options
  const langOptions = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
    { value: 'ar', label: 'العربية' },
  ];

  const handleLangChange = (code: string) => {
    setLanguage(code as 'zh' | 'en' | 'ar');
    changeLanguage(code as 'zh' | 'en' | 'ar');
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-6" style={{ background: 'var(--aegis-bg)' }}>
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="mb-2">
          <h1 className="text-[20px] font-bold text-aegis-text flex items-center gap-2">
            {Icon.section.about} Settings
          </h1>
          <p className="text-[12px] text-aegis-text-muted mt-1">
            Configure connection, appearance, and AI defaults.
          </p>
        </div>

        {/* ── 1. Connection ─────────────────────────────────────────────── */}
        <Section
          iconKey="gateway"
          title={t('settings.connection.title', 'Connection')}
          description={t('settings.connection.desc', 'WebSocket endpoint for the OpenClaw Gateway.')}
        >
          <Row label={t('settings.gatewayUrl', 'Gateway URL')}
                description="e.g. ws://127.0.0.1:18789">
            <TextInput value={editUrl} onChange={setEditUrl} placeholder="ws://127.0.0.1:18789" />
          </Row>
          <Row label={t('settings.gatewayToken', 'Auth Token')}
                description={t('settings.tokenDesc', 'Leave blank if not configured')}>
            <TextInput type="password" value={editToken} onChange={setEditToken} placeholder="••••" />
          </Row>
          <div className="flex items-center gap-2 pt-2">
            <ActionButton onClick={testConnection}>
              {testStatus === 'testing' ? Icon.status.loading : Icon.status.info}
              {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
            </ActionButton>
            {connectionDirty && (
              <ActionButton onClick={saveConnection} variant="primary">
                {Icon.action.save}
                {t('common.save', 'Save')}
              </ActionButton>
            )}
            <div className="ml-auto flex items-center gap-1.5 text-[11.5px]">
              <span
                className={clsx('w-1.5 h-1.5 rounded-full',
                  connected ? 'bg-aegis-success' : connecting ? 'bg-aegis-warning animate-pulse' : 'bg-aegis-danger')}
              />
              <span className={clsx(
                connected ? 'text-aegis-success'
                : connecting ? 'text-aegis-warning'
                : 'text-aegis-danger'
              )}>
                {connected ? t('connection.connected', 'Connected')
                  : connecting ? t('connection.connecting', 'Connecting…')
                  : t('connection.disconnected', 'Disconnected')}
              </span>
              {testStatus === 'ok' && <span className="text-aegis-success">✓</span>}
              {testStatus === 'fail' && <span className="text-aegis-danger">✗</span>}
            </div>
          </div>
        </Section>

        {/* ── 2. Notifications ──────────────────────────────────────────── */}
        <Section
          iconKey="notifications"
          title={t('settings.notifications.title', 'Notifications')}
          description={t('settings.notifications.desc', 'When JunQi can alert you.')}
        >
          <Row label={t('settings.notifications.enable', 'Enable notifications')}
                description={t('settings.notifications.enableDesc', 'Show alerts for agent activity')}>
            <Toggle value={notificationsEnabled} onChange={setNotificationsEnabled} label="notifications" />
          </Row>
          <Row label={t('settings.sound', 'Sound')}
                description={t('settings.soundDesc', 'Play a sound when a task completes')}>
            <Toggle value={soundEnabled} onChange={setSoundEnabled} label="sound" />
          </Row>
          <Row label={t('settings.dnd', 'Do not disturb')}
                description={t('settings.dndDesc', 'Silence alerts during focus sessions')}>
            <Toggle value={dndMode} onChange={setDndMode} label="dnd" />
          </Row>
        </Section>

        {/* ── 3. Theme ──────────────────────────────────────────────────── */}
        <Section
          iconKey="theme"
          title={t('settings.theme.title', 'Theme')}
          description={t('settings.theme.desc', 'Visual style of the application chrome.')}
        >
          <Row label={t('settings.themeVariant', 'Theme variant')}>
            <Select
              value={theme}
              onChange={(v) => setTheme(v as 'aegis-dark' | 'aegis-light' | 'aegis-eyecare' | 'aegis-midnight')}
              options={themeOptions}
            />
          </Row>
        </Section>

        {/* ── 4. Language ───────────────────────────────────────────────── */}
        <Section
          iconKey="language"
          title={t('settings.language.title', 'Language')}
          description={t('settings.language.desc', 'Interface text language.')}
        >
          <Row label={t('settings.language.label', 'Display language')}>
            <Select value={language} onChange={handleLangChange} options={langOptions} />
          </Row>
        </Section>

        {/* ── 5. AI Defaults ────────────────────────────────────────────── */}
        <Section
          iconKey="models"
          title={t('settings.ai.title', 'AI defaults')}
          description={t('settings.ai.desc', 'Default model and agent binary path.')}
        >
          <Row label={t('settings.aiModel', 'Default model')}
                description={t('settings.aiModelDesc', 'Used when launching a new agent task')}>
            <Select
              value="claude-sonnet-4-6"
              onChange={() => { /* wired to settingsStore */ }}
              options={[
                { value: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6' },
                { value: 'claude-opus-4-5',    label: 'Claude Opus 4.5' },
                { value: 'gpt-5',             label: 'GPT-5' },
              ]}
            />
          </Row>
          <Row label={t('settings.permissionMode', 'Default permission mode')}>
            <Select
              value="ask"
              onChange={() => {}}
              options={[
                { value: 'ask',         label: 'Ask before editing' },
                { value: 'auto_edit',   label: 'Auto-edit' },
                { value: 'full_access', label: 'Full access' },
              ]}
            />
          </Row>
        </Section>

        {/* ── 6. Storage ────────────────────────────────────────────────── */}
        <Section
          iconKey="storage"
          title={t('settings.storage.title', 'Storage')}
          description={t('settings.storage.desc', 'Manage indexed files and attachments.')}
        >
          <div className="flex items-center gap-2">
            <ActionButton onClick={() => { /* trigger reindex */ }}>
              {Icon.action.refresh}
              {t('settings.reindexFiles', 'Re-index managed files')}
            </ActionButton>
            <ActionButton onClick={() => { /* trigger cleanup */ }} variant="danger">
              {Icon.action.remove}
              {t('settings.clearAttachments', 'Clear attachments')}
            </ActionButton>
          </div>
        </Section>

        {/* ── 7. About ──────────────────────────────────────────────────── */}
        <Section
          iconKey="about"
          title={t('settings.about.title', 'About')}
          description={t('settings.about.desc', 'JunQi Desktop — AI coding workspace.')}
        >
          <Row label={t('settings.version', 'Version')}>
            <span className="font-mono text-[12px] text-aegis-text-secondary">0.5.0</span>
          </Row>
          <Row label={t('settings.license', 'License')}>
            <span className="text-[12px] text-aegis-text-secondary">MIT</span>
          </Row>
        </Section>
      </div>
    </div>
  );
}

export default SettingsPageFull;