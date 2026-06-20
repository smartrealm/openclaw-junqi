import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { themeHex } from '@/utils/theme-colors';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PetEmotion, PetState } from './pet-states';
import { pomodoroIcon, pomodoroColor, celebrateIcon, CELEBRATE_CAPTION } from './pomodoroView';

/** Fallback status labels (used until/unless i18n keys are present). */
const STATUS_LABEL: Record<PetEmotion, string> = {
  idle: '空闲中',
  thinking: '思考中',
  typing: '回复中',
  tool: '调工具',
  working: '工作中',
  happy: '完成啦',
  celebrate: '任务完成',
  error: '出错了',
  sleepy: '犯困',
  sleep: '休息中',
  memory: '整理记忆',
};

/** Per-emotion accent color so each state reads at a glance. Neutral states
 * (idle / sleepy / sleep) use slate-600 on light, slate-400 on dark, derived
 * from --aegis-text-muted — so a hardcoded gray doesn't vanish on either theme. */
const EMOTION_COLOR: Record<PetEmotion, string> = {
  idle: isDark() ? '#9aa3b2' : '#5a6473',
  thinking: themeHex('accent'),
  typing: themeHex('primary'),
  tool: themeHex('accent'),
  working: themeHex('warning'),
  happy: themeHex('success'),
  celebrate: themeHex('success'),
  error: themeHex('danger'),
  sleepy: isDark() ? '#9aa3b2' : '#5a6473',
  sleep: isDark() ? '#7a8290' : '#404a59',
  memory: themeHex('warning'),
};

/** Tiny resolver duplicated here to keep EMOTION_COLOR a module-scope constant.
 * Full version (with system-mode support + listener) lives in useResolvedDark. */
function isDark(): boolean {
  if (typeof document === 'undefined') return true;
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'aegis-dark') return true;
  if (t === 'aegis-light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

/** Active states get the rich multi-line bubble (label + action + elapsed). */
const ACTIVE: ReadonlySet<PetEmotion> = new Set(['thinking', 'typing', 'tool', 'working', 'memory']);

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

/** MM:SS for a millisecond countdown. */
function fmtClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const m = Math.floor(clamped / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Resolve the user-selected theme to a concrete "is the UI dark?" boolean
 * (handles the 'system' value by following the OS preference). */
function useResolvedDark(): boolean {
  const theme = useSettingsStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  if (theme === 'aegis-dark') return true;
  if (theme === 'aegis-light') return false;
  return systemDark;
}

/**
 * Compact status bubble above the character. No background, no border, no
 * outline / text-shadow — just the inverse-of-theme text color, which keeps
 * the bubble feeling like a native floating label rather than a panel glued
 * on top of the pet. The text inherits color from the theme only; on busy
 * desktop backgrounds it may blend in a little, which is the intended trade
 * for the lightweight look.
 *
 * Display priority (high → low):
 * dragging > error > active(chat) > celebrate/happy > pomodoro countdown >
 * sleep/sleepy > hover carousel > idle (no bubble).
 *
 * `bubbleKey` follows the bubble's logical type, so AnimatePresence cross-fades
 * when the type changes but leaves within-type updates untouched.
 */
export function PetBubble({ state, dragging, hovered }: { state: PetState; dragging?: boolean; hovered?: boolean }) {
  const { t } = useTranslation();
  const isDark = useResolvedDark();
  const e = state.emotion;
  const label = t(`pet.status.${e}`, STATUS_LABEL[e]);

  // Operation-hint carousel, shown only while the cursor is over the pet
  // AND the pet is idle (i.e. the tip branch is the rendered body — busy
  // / celebrate / pomodoro branches suppress the bubble). Cycle interval
  // 2.5s with a soft cross-fade. Leaving the pet immediately stops and
  // resets to the first tip.
  const tips = [
    t('pet.hint.tip1', '双击 → 打开主窗口'),
    t('pet.hint.tip2', '按住拖动 → 移动位置'),
    t('pet.hint.tip3', '托盘图标 → 显示/隐藏'),
    t('pet.hint.tip4', '右键 → 菜单 / 番茄控制'),
  ];
  // Carousel is only visible in the idle branch, so drive the interval off
  // the same condition — saves a setInterval in every busy/celebrate state.
  const carouselActive = hovered && e === 'idle';
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    if (!carouselActive) {
      setTipIndex(0);
      return;
    }
    setTipIndex(0);
    const id = setInterval(() => setTipIndex((i) => (i + 1) % tips.length), 2500);
    return () => clearInterval(id);
  }, [carouselActive, tips.length]);

  // Base bubble style: pure text, no background / border / shadow / outline.
  // Color flips with the theme so it reads on either desktop wallpaper.
  const bubbleStyle: CSSProperties = {
    maxWidth: 240,
    textAlign: 'center',
    color: isDark ? '#ffffff' : '#16181f',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.4,
  };

  let body: ReactNode = null;
  let bubbleKey = '';

  if (dragging) {
    bubbleKey = 'dragging';
    body = <span style={{ fontWeight: 600 }}>{t('pet.hint.moving', '移动中…')}</span>;
  } else if (e === 'error') {
    bubbleKey = 'error';
    body = <span style={{ fontWeight: 700, color: EMOTION_COLOR[e] }}>{label}</span>;
  } else if (ACTIVE.has(e)) {
    bubbleKey = `active-${e}`;
    const detail = state.message || state.taskLabel;
    const elapsed = state.elapsedMs ? fmtDuration(state.elapsedMs) : null;
    body = (
      <>
        <span style={{ fontWeight: 600, color: EMOTION_COLOR[e] }}>
          {label}
          {elapsed && <span style={{ fontSize: 10.5, opacity: 0.65, fontWeight: 400 }}> · {elapsed}</span>}
        </span>
        {detail && (
          <div style={{ fontSize: 10.5, opacity: 0.75, maxWidth: 220, marginTop: 1, wordBreak: 'break-word' }}>
            {detail}
          </div>
        )}
      </>
    );
  } else if (e === 'happy' || e === 'celebrate') {
    // A finished pomodoro phase shows its own caption (+ an icon) instead of
    // the generic one.
    bubbleKey = `celebrate-${state.celebrateKind ?? 'task'}`;
    const pomoKind = e === 'celebrate' && state.celebrateKind && state.celebrateKind !== 'task' ? state.celebrateKind : null;
    const caption = pomoKind ? t(CELEBRATE_CAPTION[pomoKind].key, CELEBRATE_CAPTION[pomoKind].fallback) : label;
    const CelebrateIcon = pomoKind ? celebrateIcon(pomoKind) : null;
    body = (
      <span style={{ fontWeight: 600, color: EMOTION_COLOR[e], display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {CelebrateIcon && <CelebrateIcon size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />}
        {caption}
      </span>
    );
  } else if (state.pomodoro?.enabled && state.pomodoro.running) {
    // Live countdown — shown only when the pet isn't busy with chat or celebrating.
    // Key excludes the seconds so the countdown ticks in place (no cross-fade).
    const p = state.pomodoro;
    bubbleKey = `pomo-${p.phase}-${p.paused ? 'paused' : 'run'}`;
    const phaseLabel = p.paused
      ? t('pet.pomodoro.paused', '已暂停')
      : t(p.phase === 'work' ? 'pet.pomodoro.focusing' : 'pet.pomodoro.resting', p.phase === 'work' ? '专注中' : '休息中');
    const PomoIcon = pomodoroIcon(p);
    body = (
      <span style={{ fontWeight: 600, color: pomodoroColor(p), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <PomoIcon size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        {p.paused ? phaseLabel : `${phaseLabel} ${fmtClock(p.remainingMs)}`}
      </span>
    );
  } else if (e === 'sleep' || e === 'sleepy') {
    bubbleKey = e;
    body = <span style={{ opacity: 0.85, color: EMOTION_COLOR[e] }}>{label}</span>;
  } else if (hovered) {
    bubbleKey = 'tips';
    body = (
      // Cross-fade between tips — old tip fades out as new one fades in,
      // so the carousel never "snaps". Y stays at 0 so the line position
      // doesn't bob while the user reads.
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={tipIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeInOut' }}
          style={{ display: 'block' }}
        >
          {tips[tipIndex]}
        </motion.span>
      </AnimatePresence>
    );
  } else {
    // idle & not hovered — no bubble.
    bubbleKey = 'idle';
    body = null;
  }

  return (
    <AnimatePresence>
      {body && (
        <motion.div
          key={bubbleKey}
          initial={{ opacity: 0, y: 6, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.18 }}
          style={bubbleStyle}
        >
          {body}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
