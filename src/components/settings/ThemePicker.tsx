/**
 * ThemePicker — 1:1 port of hanshuaikang/nezha's ThemePanel.
 *
 * Source: nezha/src/components/app-settings/ThemePanel.tsx
 *
 * Structural fidelity:
 *   - Top: "Follow system" toggle row with selectedLabel chip on the right.
 *   - Bottom: "Manual theme" 2×2 card grid (dark / midnight / light / eyecare).
 *   - Card preview: dot strip + sidebar + content layout (3-column-ish).
 *   - Keyboard nav: Arrow / Home / End on the manual cards.
 *   - aria-checked on cards (role=radio), aria-checked on toggle (role=switch).
 *
 * Style fidelity:
 *   nezha uses CSS vars from its own design system (--text-primary,
 *   --bg-subtle, --control-active-fg, etc.). We map them to our aegis
 *   tokens via local CSS variables on the wrapper, so the inline-style
 *   code from nezha can be copied verbatim. See AEGIS_VAR_MAP below.
 *
 * Behavior fidelity:
 *   themeMode ∈ {'system','dark','midnight','light','eyecare'}.
 *   We translate from our ThemeSetting ('system' | AegisTheme) by stripping
 *   the 'aegis-' prefix. See toNezhaMode / toAegisSetting.
 */
import type React from 'react';
import { Check, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AegisTheme, ThemeSetting } from '@/theme';

// ── Mode translation between our store shape and nezha's shape ──

/** Nezha's narrower mode union (no `aegis-` prefix). */
type NezhaMode = 'system' | 'dark' | 'midnight' | 'light' | 'eyecare';
type NezhaManualMode = Exclude<NezhaMode, 'system'>;

function toNezhaMode(setting: ThemeSetting): NezhaMode {
  if (setting === 'system') return 'system';
  // ThemeSetting concrete values are all 'aegis-<mode>' — strip the prefix.
  return setting.replace(/^aegis-/, '') as NezhaManualMode;
}

function toAegisSetting(mode: NezhaMode): ThemeSetting {
  if (mode === 'system') return 'system';
  return `aegis-${mode}` as AegisTheme;
}

// ── Component ──

interface ThemePickerProps {
  /** Current user-selected ThemeSetting from the store. */
  value: ThemeSetting;
  /** Setter; called with the new ThemeSetting after the user picks. */
  onChange: (next: ThemeSetting) => void;
  /** OS color-scheme preference, used to render the "Following system · {mode}" chip. */
  systemPrefersDark: boolean;
}

export function ThemePicker({ value, onChange, systemPrefersDark }: ThemePickerProps) {
  const { t } = useTranslation();
  const themeMode = toNezhaMode(value);
  const setThemeMode = (mode: NezhaMode) => onChange(toAegisSetting(mode));

  // Order matters — used for arrow-key navigation, matches nezha verbatim.
  const manualThemeModes: NezhaManualMode[] = ['dark', 'midnight', 'light', 'eyecare'];

  // Chip on the right of the system row: "Following system · Dark" /
  // "Manual · Eye-care". Built from two i18n strings + a {mode} interp.
  const currentModeLabel = systemPrefersDark ? t('theme.dark') : t('theme.light');
  const manualModeLabel =
    themeMode === 'dark' ? t('theme.dark')
      : themeMode === 'midnight' ? t('theme.midnight')
        : themeMode === 'eyecare' ? t('theme.eyecare')
          : t('theme.light');
  const selectedLabel =
    themeMode === 'system'
      ? t('theme.followingSystem', { mode: currentModeLabel })
      : t('theme.manual', { mode: manualModeLabel });

  function handleSystemThemeToggle() {
    setThemeMode(themeMode === 'system' ? 'light' : 'system');
  }

  function handleManualThemeKeyDown(
    mode: NezhaManualMode,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    const currentIndex = manualThemeModes.indexOf(mode);
    if (currentIndex === -1) return;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      setThemeMode(manualThemeModes[(currentIndex + 1) % manualThemeModes.length]);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setThemeMode(manualThemeModes[(currentIndex - 1 + manualThemeModes.length) % manualThemeModes.length]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setThemeMode(manualThemeModes[0]);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setThemeMode(manualThemeModes[manualThemeModes.length - 1]);
    }
  }

  function renderThemeOption({
    mode,
    title,
    description,
    previewBackground,
    previewBorder,
    previewAccent,
  }: {
    mode: NezhaManualMode;
    title: string;
    description: string;
    previewBackground: string;
    previewBorder: string;
    previewAccent: string;
  }) {
    const selected = themeMode === mode;
    const isDark = mode === 'dark' || mode === 'midnight';

    return (
      <button
        key={mode}
        type="button"
        onClick={() => setThemeMode(mode)}
        onKeyDown={(event) => handleManualThemeKeyDown(mode, event)}
        role="radio"
        aria-checked={selected}
        aria-label={title}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 10,
          padding: 14,
          borderRadius: 12,
          border: `1px solid ${selected ? 'var(--control-active-fg)' : 'var(--border-medium)'}`,
          background: selected ? 'var(--control-active-bg)' : 'var(--bg-subtle)',
          cursor: 'pointer',
          textAlign: 'left',
          boxShadow: selected ? '0 0 0 1px var(--control-active-bg)' : 'none',
          transition: 'border-color 0.12s, background 0.12s, box-shadow 0.12s',
        }}
      >
        <div
          style={{
            width: '100%',
            height: 106,
            borderRadius: 10,
            border: `1px solid ${previewBorder}`,
            background: previewBackground,
            padding: 8,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            overflow: 'hidden',
          }}
        >
          {/* dot strip — three traffic-light style dots */}
          <div style={{ display: 'flex', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: previewAccent, opacity: 0.9 }} />
            <span style={{ width: 7, height: 7, borderRadius: 999, background: previewAccent, opacity: 0.65 }} />
            <span style={{ width: 7, height: 7, borderRadius: 999, background: previewAccent, opacity: 0.4 }} />
          </div>
          <div
            style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: isDark ? '28px 1fr' : '24px 1fr',
              gap: 7,
            }}
          >
            {/* mini sidebar with 3 nav-line placeholders */}
            <div
              style={{
                borderRadius: 7,
                background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(23,27,36,0.06)',
                border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(23,27,36,0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                padding: '7px 5px',
              }}
            >
              <span style={{ height: 5, borderRadius: 999, background: previewAccent, opacity: isDark ? 0.55 : 0.3 }} />
              <span style={{ height: 5, borderRadius: 999, background: previewAccent, opacity: isDark ? 0.28 : 0.16 }} />
              <span style={{ height: 5, borderRadius: 999, background: previewAccent, opacity: isDark ? 0.2 : 0.12 }} />
            </div>
            {/* mini main content */}
            <div
              style={{
                borderRadius: 8,
                background: isDark
                  ? 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))'
                  : 'linear-gradient(180deg, rgba(23,27,36,0.1), rgba(23,27,36,0.04))',
                border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(23,27,36,0.08)',
                padding: 8,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span
                  style={{
                    width: 34, height: 6, borderRadius: 999,
                    background: previewAccent, opacity: isDark ? 0.75 : 0.2,
                  }}
                />
                <span
                  style={{
                    width: 12, height: 12, borderRadius: 4,
                    background: isDark ? 'rgba(255,255,255,0.12)' : '#ffffff',
                    border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(23,27,36,0.08)',
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 6, flex: 1 }}>
                <div
                  style={{
                    borderRadius: 6,
                    background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.9)',
                    border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(23,27,36,0.06)',
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span
                    style={{
                      height: 18, borderRadius: 6,
                      background: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.92)',
                      border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(23,27,36,0.06)',
                    }}
                  />
                  <span
                    style={{
                      flex: 1, borderRadius: 6,
                      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.82)',
                      border: isDark ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(23,27,36,0.05)',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* label + description */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {title}
            </span>
            {selected && <Check size={14} color="var(--accent-color)" />}
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--text-hint)', lineHeight: 1.45 }}>
            {description}
          </span>
        </div>
      </button>
    );
  }

  return (
    <div
      // Local re-declaration: nezha's tokens → our --aegis-* tokens.
      // Defining them on the wrapper keeps the rest of the file a
      // verbatim port of nezha's inline styles — no rewrites needed.
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        // — nezha token aliases —
        '--text-primary': 'rgb(var(--aegis-text))',
        '--text-secondary': 'rgb(var(--aegis-text-secondary))',
        '--text-hint': 'rgb(var(--aegis-text-muted))',
        '--bg-card': 'var(--aegis-card)',
        '--bg-subtle': 'var(--aegis-elevated)',
        '--border-dim': 'var(--aegis-border)',
        '--border-medium': 'var(--aegis-border-hover)',
        '--control-active-fg': 'rgb(var(--aegis-primary))',
        '--control-active-bg': 'rgb(var(--aegis-primary) / 0.10)',
        '--control-knob-bg': 'rgb(var(--aegis-overlay) / 0.92)',
        '--primary-action-bg': 'rgb(var(--aegis-primary))',
        '--accent-color': 'rgb(var(--aegis-primary))',
      } as React.CSSProperties}
    >
      {/* ── Follow-system toggle ── */}
      <button
        type="button"
        onClick={handleSystemThemeToggle}
        role="switch"
        aria-checked={themeMode === 'system'}
        aria-label={t('theme.followSystemAria')}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          padding: '16px 18px',
          borderRadius: 12,
          border: `1px solid ${themeMode === 'system' ? 'var(--control-active-fg)' : 'var(--border-dim)'}`,
          background: themeMode === 'system' ? 'var(--control-active-bg)' : 'var(--bg-subtle)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              flexShrink: 0,
              width: 48,
              height: 28,
              borderRadius: 999,
              border: 'none',
              padding: 3,
              background: themeMode === 'system' ? 'var(--primary-action-bg)' : 'var(--border-medium)',
              boxShadow:
                themeMode === 'system' ? '0 0 0 4px var(--control-active-bg)' : 'inset 0 0 0 1px var(--border-dim)',
              transition: 'background 0.12s, box-shadow 0.12s',
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--control-knob-bg)',
                color: themeMode === 'system' ? 'var(--accent-color)' : 'var(--text-secondary)',
                transform: themeMode === 'system' ? 'translateX(20px)' : 'translateX(0)',
                transition: 'transform 0.12s ease',
              }}
            >
              <Monitor size={12} />
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              minWidth: 0,
              padding: 0,
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {t('theme.followSystem')}
            </span>
          </div>
        </div>
        <div
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-secondary)',
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          {themeMode === 'system' && <Check size={13} color="var(--accent-color)" />}
          {selectedLabel}
        </div>
      </button>

      {/* ── Manual theme 2×2 cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {t('theme.manualTheme')}
        </div>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}
          role="radiogroup"
          aria-label={t('theme.manualThemeAria')}
        >
          {renderThemeOption({
            mode: 'dark',
            title: t('theme.dark'),
            description: t('theme.darkDescription'),
            previewBackground: '#11151d',
            previewBorder: 'rgba(255,255,255,0.08)',
            previewAccent: '#f1f4fb',
          })}
          {renderThemeOption({
            mode: 'midnight',
            title: t('theme.midnight'),
            description: t('theme.midnightDescription'),
            previewBackground: '#1a1b1d',
            previewBorder: '#222427',
            previewAccent: '#e6e6e6',
          })}
          {renderThemeOption({
            mode: 'light',
            title: t('theme.light'),
            description: t('theme.lightDescription'),
            previewBackground: '#f5f7fb',
            previewBorder: 'rgba(23,27,36,0.08)',
            previewAccent: '#171b24',
          })}
          {renderThemeOption({
            mode: 'eyecare',
            title: t('theme.eyecare'),
            description: t('theme.eyecareDescription'),
            previewBackground: '#f5ecd7',
            previewBorder: 'rgba(101,84,51,0.16)',
            previewAccent: '#5a4a30',
          })}
        </div>
      </div>
    </div>
  );
}
