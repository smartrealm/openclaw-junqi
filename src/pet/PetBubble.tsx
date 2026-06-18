import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { themeHex } from '@/utils/theme-colors';
import type { CelebrateKind, PetEmotion, PetState } from './pet-states';
import { pomodoroIcon, pomodoroColor, celebrateIcon } from './pomodoroView';

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

/** Per-emotion accent color so each state reads at a glance. */
const EMOTION_COLOR: Record<PetEmotion, string> = {
  idle: '#9aa3b2',
  thinking: themeHex('accent'),
  typing: themeHex('primary'),
  tool: themeHex('accent'),
  working: themeHex('warning'),
  happy: themeHex('success'),
  celebrate: themeHex('success'),
  error: themeHex('danger'),
  sleepy: '#9aa3b2',
  sleep: '#7a8290',
  memory: themeHex('warning'),
};

/** Active states get the rich multi-line bubble (label + action + elapsed). */
const ACTIVE: ReadonlySet<PetEmotion> = new Set(['thinking', 'typing', 'tool', 'working', 'memory']);

/** Pomodoro celebrate captions, keyed by which phase just finished. */
const POMODORO_KIND_CAPTION: Record<Exclude<CelebrateKind, 'task'>, { key: string; fallback: string }> = {
  pomodoroWork: { key: 'pet.pomodoro.workDone', fallback: '专注完成，休息一下！' },
  pomodoroWorkLong: { key: 'pet.pomodoro.workDoneLong', fallback: '4 轮专注完成，长休息一下！' },
  pomodoroBreak: { key: 'pet.pomodoro.breakDone', fallback: '休息结束，继续专注！' },
};

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

// Minimal: no background, no border, no dot, no ring — just colored text.
const BUBBLE: CSSProperties = {
  maxWidth: 124,
  color: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 10,
  lineHeight: 1.3,
};

/**
 * Compact status bubble above the character. Plain text only (label tinted by
 * emotion + elapsed time + a detail line). Display priority (high → low):
 * dragging > error > active(chat) > celebrate/happy > pomodoro countdown >
 * sleep/sleepy > hover carousel > idle (no bubble). Live task info and the
 * pomodoro countdown beat the "how to use me" hints; chat celebrations briefly
 * take priority over the countdown so a finished pomodoro phase shows its own
 * caption for a moment before the next countdown takes over.
 *
 * `bubbleKey` follows the bubble's logical type (not the ticking seconds or the
 * carousel index), so AnimatePresence cross-fades when the type changes but
 * leaves within-type updates (the countdown, the tip carousel) untouched.
 */
export function PetBubble({ state, dragging, hovered }: { state: PetState; dragging?: boolean; hovered?: boolean }) {
  const { t } = useTranslation();
  const e = state.emotion;
  const label = t(`pet.status.${e}`, STATUS_LABEL[e]);

  // Operation-hint carousel, shown while the cursor is over the pet (idle).
  const tips = [
    t('pet.hint.tip1', '双击 → 打开主窗口'),
    t('pet.hint.tip2', '按住拖动 → 移动位置'),
    t('pet.hint.tip3', '托盘图标 → 显示/隐藏'),
  ];
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    if (!hovered) return;
    setTipIndex(0);
    const id = setInterval(() => setTipIndex((i) => (i + 1) % tips.length), 2200);
    return () => clearInterval(id);
  }, [hovered, tips.length]);

  let body: ReactNode = null;
  let bubbleKey = '';

  if (dragging) {
    bubbleKey = 'dragging';
    body = <span style={{ fontSize: 10 }}>{t('pet.hint.moving', '移动中…')}</span>;
  } else if (e === 'error') {
    bubbleKey = 'error';
    body = <span style={{ fontSize: 10, fontWeight: 600, color: EMOTION_COLOR[e] }}>{label}</span>;
  } else if (ACTIVE.has(e)) {
    bubbleKey = `active-${e}`;
    const detail = state.message || state.taskLabel;
    const elapsed = state.elapsedMs ? fmtDuration(state.elapsedMs) : null;
    body = (
      <>
        <span style={{ fontSize: 10, fontWeight: 600, color: EMOTION_COLOR[e] }}>
          {label}
          {elapsed && <span style={{ fontSize: 9, opacity: 0.6, fontWeight: 400 }}> · {elapsed}</span>}
        </span>
        {detail && (
          <div style={{ fontSize: 9, opacity: 0.7, maxWidth: 116, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {detail}
          </div>
        )}
      </>
    );
  } else if (e === 'happy' || e === 'celebrate') {
    // A finished pomodoro phase shows its own caption (+ an emoji) instead of
    // the generic one.
    bubbleKey = `celebrate-${state.celebrateKind ?? 'task'}`;
    const pomoKind = e === 'celebrate' && state.celebrateKind && state.celebrateKind !== 'task' ? state.celebrateKind : null;
    const caption = pomoKind ? t(POMODORO_KIND_CAPTION[pomoKind].key, POMODORO_KIND_CAPTION[pomoKind].fallback) : label;
    const CelebrateIcon = pomoKind ? celebrateIcon(pomoKind) : null;
    body = (
      <span style={{ fontSize: 10, fontWeight: 600, color: EMOTION_COLOR[e], display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {CelebrateIcon && <CelebrateIcon size={11} strokeWidth={2.2} style={{ flexShrink: 0 }} />}
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
      <span style={{ fontSize: 10, fontWeight: 600, color: pomodoroColor(p), display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <PomoIcon size={11} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        {p.paused ? phaseLabel : `${phaseLabel} ${fmtClock(p.remainingMs)}`}
      </span>
    );
  } else if (e === 'sleep' || e === 'sleepy') {
    bubbleKey = e;
    body = <span style={{ fontSize: 10, opacity: 0.85, color: EMOTION_COLOR[e] }}>{label}</span>;
  } else if (hovered) {
    bubbleKey = 'tips';
    body = (
      <motion.span
        key={tipIndex}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ fontSize: 9.5, display: 'block', whiteSpace: 'nowrap' }}
      >
        {tips[tipIndex]}
      </motion.span>
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
          initial={{ opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.18 }}
          style={BUBBLE}
        >
          {body}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
