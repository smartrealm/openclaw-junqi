import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ProgressRing, StatusDot } from '@/components/shared';
import type { PetEmotion, PetState } from './pet-states';

/** Map pet emotions onto the shared StatusDot palette. */
const DOT_STATUS: Record<PetEmotion, 'active' | 'idle' | 'sleeping' | 'error' | 'paused'> = {
  idle: 'idle',
  thinking: 'active',
  typing: 'active',
  working: 'active',
  happy: 'active',
  celebrate: 'active',
  error: 'error',
  sleepy: 'sleeping',
  sleep: 'sleeping',
  memory: 'paused',
};

/** Fallback status labels (used until/unless i18n keys are present). */
const STATUS_LABEL: Record<PetEmotion, string> = {
  idle: '待机',
  thinking: '思考中',
  typing: '回复中',
  working: '工作中',
  happy: '完成啦',
  celebrate: '任务完成',
  error: '出错了',
  sleepy: '犯困',
  sleep: '休息中',
  memory: '整理记忆',
};

/** Active states get the rich multi-line bubble (label + action + elapsed + ring). */
const ACTIVE: ReadonlySet<PetEmotion> = new Set(['thinking', 'typing', 'working', 'memory']);

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

// Fully transparent — no background, no border, no text outline. Just text.
const BUBBLE: CSSProperties = {
  maxWidth: 124,
  color: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 10,
  lineHeight: 1.3,
};

/**
 * Compact status bubble above the character. Display priority (high → low):
 *   1. dragging          → "moving" (immediate drag feedback)
 *   2. error             → error label
 *   3. active            → label + concrete action + elapsed time + progress ring
 *                          (thinking / typing / working / memory)
 *   4. happy / celebrate → completion label (transient)
 *   5. sleep / sleepy    → resting label
 *   6. hovered           → carousel of operation hints (only when idle)
 *   7. idle              → a single static hint
 * Rationale: live task info always beats "how to use me" hints — hovering while
 * the AI is replying still shows the reply status, not the hint carousel.
 */
export function PetBubble({ state, dragging, hovered }: { state: PetState; dragging?: boolean; hovered?: boolean }) {
  const { t } = useTranslation();
  const e = state.emotion;
  const label = t(`pet.status.${e}`, STATUS_LABEL[e]);

  // Operation-hint carousel — only meaningful when nothing more important is up.
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
    body = (
      <Row>
        <span style={{ fontSize: 10 }}>{t('pet.hint.moving', '移动中…')}</span>
      </Row>
    );
  } else if (e === 'error') {
    body = (
      <Row>
        <StatusDot status="error" size={6} />
        <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
      </Row>
    );
  } else if (ACTIVE.has(e)) {
    const detail = state.message || state.taskLabel;
    const elapsed = state.elapsedMs ? fmtDuration(state.elapsedMs) : null;
    const showRing = (e === 'working' || e === 'typing') && typeof state.progress === 'number';
    body = (
      <>
        <Row>
          <StatusDot status={DOT_STATUS[e]} size={6} pulse={e === 'working' || e === 'typing'} />
          <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
          {elapsed && <span style={{ fontSize: 9, opacity: 0.6 }}>· {elapsed}</span>}
          {showRing && <ProgressRing percentage={state.progress ?? 0} size={13} strokeWidth={2.5} />}
        </Row>
        {detail && (
          <div style={{ fontSize: 9, opacity: 0.7, maxWidth: 104, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {detail}
          </div>
        )}
      </>
    );
  } else if (e === 'happy' || e === 'celebrate') {
    body = (
      <Row>
        <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
      </Row>
    );
  } else if (e === 'sleep' || e === 'sleepy') {
    body = (
      <Row>
        <StatusDot status="sleeping" size={6} />
        <span style={{ fontSize: 10, opacity: 0.85 }}>{label}</span>
      </Row>
    );
  } else if (hovered) {
    body = <span style={{ fontSize: 9.5, display: 'block', whiteSpace: 'nowrap' }}>{tips[tipIndex]}</span>;
  } else {
    // idle & not hovered — no bubble. Keeps the tiny window uncluttered; the
    // hint carousel above appears on hover, and live states show their own text.
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

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{children}</div>;
}
