/**
 * Emotion configuration — pure data, no rendering. Each PetEmotion maps to how
 * the character should look and move (mouth path, eye state, pose, breathing
 * speed, which head effect). Kept separate so it's trivially unit-testable and
 * so adding a new emotion is a one-line table change.
 */
import type { PetEmotion } from './pet-states';

export type EffectKind =
  | 'none' | 'sleep' | 'gear' | 'think' | 'stars' | 'hearts' | 'sweat' | 'book' | 'spark';

export interface EmotionCfg {
  /** SVG path for the mouth. */
  mouth: string;
  /** 0..1 vertical eye scale (0 = closed). */
  eyeOpen: number;
  /** -2..2 horizontal pupil offset (gaze direction). */
  pupilDx: number;
  /** Body vertical offset (px) for the pose. */
  bodyY: number;
  /** Body scale for the pose. */
  bodyScale: number;
  /** Body rotation (deg) for the pose. */
  bodyRotate: number;
  /** Show cheek blush. */
  cheeks: boolean;
  /** Head effect to render above the character. */
  effect: EffectKind;
  /** Breathing speed multiplier. */
  breath: number;
}

export const EMOTION_CFG: Record<PetEmotion, EmotionCfg> = {
  idle: { mouth: 'M48,86 Q60,97 72,86', eyeOpen: 1, pupilDx: 0, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'none', breath: 1 },
  working: { mouth: 'M55,88 Q60,84 65,88 Q60,93 55,88', eyeOpen: 1, pupilDx: 0, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'gear', breath: 0.7 },
  thinking: { mouth: 'M54,91 L66,91', eyeOpen: 1, pupilDx: 1.6, bodyY: 0, bodyScale: 1, bodyRotate: -3, cheeks: false, effect: 'think', breath: 0.6 },
  typing: { mouth: 'M56,90 Q60,88 64,90', eyeOpen: 0.9, pupilDx: 0, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'spark', breath: 1.7 },
  tool: { mouth: 'M55,88 Q60,84 65,88 Q60,93 55,88', eyeOpen: 1, pupilDx: 0, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'gear', breath: 0.9 },
  happy: { mouth: 'M43,82 Q60,108 77,82', eyeOpen: 0.85, pupilDx: 0, bodyY: -2, bodyScale: 1.04, bodyRotate: 0, cheeks: true, effect: 'stars', breath: 1.3 },
  celebrate: { mouth: 'M43,82 Q60,110 77,82', eyeOpen: 0.8, pupilDx: 0, bodyY: -7, bodyScale: 1.06, bodyRotate: 0, cheeks: true, effect: 'hearts', breath: 1.5 },
  error: { mouth: 'M48,95 Q60,84 72,95', eyeOpen: 0.8, pupilDx: 0, bodyY: 1, bodyScale: 0.98, bodyRotate: 0, cheeks: false, effect: 'sweat', breath: 0.5 },
  sleepy: { mouth: 'M54,90 Q60,93 66,90', eyeOpen: 0.35, pupilDx: 0, bodyY: 2, bodyScale: 1, bodyRotate: 2, cheeks: false, effect: 'none', breath: 0.5 },
  sleep: { mouth: 'M54,90 L66,90', eyeOpen: 0.06, pupilDx: 0, bodyY: 3, bodyScale: 0.99, bodyRotate: 3, cheeks: false, effect: 'sleep', breath: 0.4 },
  memory: { mouth: 'M54,90 Q60,88 66,90', eyeOpen: 1, pupilDx: -1.2, bodyY: 0, bodyScale: 1, bodyRotate: 0, cheeks: false, effect: 'book', breath: 0.8 },
};
