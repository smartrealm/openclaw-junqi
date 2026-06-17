import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { themeHex } from '@/utils/theme-colors';
import type { PetEmotion, PetState } from './pet-states';

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

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
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
 * dragging > error > active > happy/celebrate > sleep/sleepy > hover carousel
 * > idle (no bubble). Live task info beats "how to use me" hints.
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

  if (dragging) {
    body = <span style={{ fontSize: 10 }}>{t('pet.hint.moving', '移动中…')}</span>;
  } else if (e === 'error') {
    body = <span style={{ fontSize: 10, fontWeight: 600, color: EMOTION_COLOR[e] }}>{label}</span>;
  } else if (ACTIVE.has(e)) {
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
    body = <span style={{ fontSize: 10, fontWeight: 600, color: EMOTION_COLOR[e] }}>{label}</span>;
  } else if (e === 'sleep' || e === 'sleepy') {
    body = <span style={{ fontSize: 10, opacity: 0.85, color: EMOTION_COLOR[e] }}>{label}</span>;
  } else if (hovered) {
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
    body = null;
  }

  return (
    <AnimatePresence>
      {body && (
        <motion.div
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
