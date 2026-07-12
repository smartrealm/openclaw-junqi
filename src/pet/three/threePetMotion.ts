import type { PetEmotion } from '../pet-states';

/**
 * The WebGL pet has a small, continuous pose vocabulary rather than a set of
 * disconnected one-shot animations. Business state stays in `pet-states`; this
 * module only turns that state into bounded motion values for the renderer.
 */
export type ThreePetAnimation =
  | 'idle'
  | 'greet'
  | 'work'
  | 'think'
  | 'celebrate'
  | 'sad'
  | 'sleep'
  | 'alert'
  | 'chew'
  | 'walk';

export interface ThreePetMotionInput {
  emotion: PetEmotion;
  dragging: boolean;
  hovered: boolean;
  walkDir: number;
  dragDx: number;
  dragDy: number;
}

export interface ThreePetPose {
  animation: ThreePetAnimation;
  bodyY: number;
  bodyScaleY: number;
  bodyScaleX: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  armLeft: number;
  armRight: number;
  footLeft: number;
  footRight: number;
  antenna: number;
  gazeX: number;
  gazeY: number;
  eyeScaleY: number;
  shadowScale: number;
  sparkle: number;
}

const TAU = Math.PI * 2;

export function animationForThreePet(input: Pick<ThreePetMotionInput, 'emotion' | 'dragging' | 'hovered'>): ThreePetAnimation {
  if (input.dragging) return 'walk';
  if (input.hovered && input.emotion === 'idle') return 'greet';

  switch (input.emotion) {
    case 'working':
    case 'typing':
    case 'tool':
    case 'memory':
      return 'work';
    case 'thinking':
      return 'think';
    case 'happy':
    case 'celebrate':
      return 'celebrate';
    case 'error':
      return 'sad';
    case 'sleepy':
    case 'sleep':
      return 'sleep';
    case 'drag':
    case 'overdrag':
      return 'alert';
    case 'swallow':
    case 'rapidSwallow':
      return 'chew';
    case 'idle':
      return 'idle';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Samples a pose at a stable timestamp. Every output is deliberately bounded:
 * drag data comes from screen coordinates and must never fling the model off
 * camera or invert its body after a monitor/DPI change.
 */
export function sampleThreePetPose(input: ThreePetMotionInput, elapsedMs: number): ThreePetPose {
  const animation = animationForThreePet(input);
  const speed = animation === 'work' || animation === 'walk' ? 1.65 : animation === 'sleep' ? 0.45 : 1;
  const t = elapsedMs / 1000 * speed;
  const breath = Math.sin(t * TAU * 0.3);
  const walkDirection = input.walkDir < 0 ? -1 : input.walkDir > 0 ? 1 : 0;
  const gazeX = clamp(input.dragDx / 38, -0.28, 0.28);
  const gazeY = clamp(-input.dragDy / 48, -0.2, 0.2);

  const pose: ThreePetPose = {
    animation,
    bodyY: breath * 0.035,
    bodyScaleY: 1 + breath * 0.018,
    bodyScaleX: 1 - breath * 0.01,
    headPitch: breath * 0.035,
    headYaw: 0,
    headRoll: 0,
    armLeft: breath * 0.08,
    armRight: -breath * 0.08,
    footLeft: 0,
    footRight: 0,
    antenna: breath * 0.12,
    gazeX: 0,
    gazeY: 0,
    eyeScaleY: 1,
    shadowScale: 1 - breath * 0.06,
    sparkle: 0,
  };

  switch (animation) {
    case 'greet': {
      const wave = Math.sin(t * TAU * 1.5);
      pose.bodyY += Math.sin(t * TAU * 0.7) * 0.055;
      pose.headYaw = -0.12;
      pose.armRight = -0.8 + wave * 0.46;
      pose.antenna = wave * 0.3;
      pose.sparkle = 0.28;
      break;
    }
    case 'work': {
      const tap = Math.sin(t * TAU * 1.45);
      pose.bodyY += Math.max(0, tap) * 0.035;
      pose.headPitch = 0.11 + Math.sin(t * TAU * 0.72) * 0.035;
      pose.armLeft = -0.22 + tap * 0.34;
      pose.armRight = 0.22 - tap * 0.34;
      pose.gazeY = -0.08;
      pose.antenna = Math.sin(t * TAU * 1.1) * 0.2;
      break;
    }
    case 'think':
      pose.headYaw = Math.sin(t * TAU * 0.26) * 0.28;
      pose.headPitch = -0.09;
      pose.armLeft = -0.22;
      pose.armRight = 0.3;
      pose.gazeX = 0.12;
      pose.gazeY = 0.12;
      pose.antenna = Math.sin(t * TAU * 0.9) * 0.3;
      break;
    case 'celebrate': {
      const hop = Math.max(0, Math.sin(t * TAU * 1.65));
      pose.bodyY += hop * 0.3;
      pose.bodyScaleY = 1 - hop * 0.13;
      pose.bodyScaleX = 1 + hop * 0.09;
      pose.armLeft = -0.95 + hop * 0.2;
      pose.armRight = 0.95 - hop * 0.2;
      pose.footLeft = -hop * 0.12;
      pose.footRight = -hop * 0.12;
      pose.antenna = Math.sin(t * TAU * 1.65) * 0.4;
      pose.shadowScale = 1 - hop * 0.38;
      pose.sparkle = 1;
      break;
    }
    case 'sad':
      pose.bodyY -= 0.055;
      pose.headPitch = 0.22;
      pose.headRoll = Math.sin(t * TAU * 0.38) * 0.08;
      pose.armLeft = 0.24;
      pose.armRight = -0.24;
      pose.gazeY = -0.13;
      pose.eyeScaleY = 0.7;
      pose.antenna = -0.18;
      break;
    case 'sleep':
      pose.bodyY += Math.sin(t * TAU * 0.16) * 0.028;
      pose.bodyScaleY = 1 + Math.sin(t * TAU * 0.16) * 0.028;
      pose.headPitch = 0.32;
      pose.headRoll = -0.1;
      pose.armLeft = 0.3;
      pose.armRight = -0.3;
      pose.gazeY = -0.16;
      pose.eyeScaleY = 0.08;
      pose.antenna = -0.18;
      break;
    case 'alert':
      pose.bodyY += Math.sin(t * TAU * 2.1) * 0.025;
      pose.headPitch = -0.13;
      pose.headYaw = gazeX * 0.9;
      pose.headRoll = clamp(-input.dragDx / 190, -0.16, 0.16);
      pose.armLeft = -0.42;
      pose.armRight = 0.42;
      pose.gazeX = gazeX;
      pose.gazeY = gazeY;
      pose.eyeScaleY = input.emotion === 'overdrag' ? 1.18 : 1.08;
      pose.antenna = Math.sin(t * TAU * 1.8) * 0.4;
      pose.sparkle = input.emotion === 'overdrag' ? 0.52 : 0.12;
      break;
    case 'chew': {
      const chew = Math.sin(t * TAU * 3.2);
      pose.bodyY += Math.abs(chew) * 0.045;
      pose.bodyScaleY = 1 - Math.abs(chew) * 0.065;
      pose.bodyScaleX = 1 + Math.abs(chew) * 0.05;
      pose.headPitch = chew * 0.09;
      pose.armLeft = -0.16 + chew * 0.14;
      pose.armRight = 0.16 - chew * 0.14;
      pose.eyeScaleY = 0.82;
      pose.sparkle = input.emotion === 'rapidSwallow' ? 0.7 : 0.34;
      break;
    }
    case 'walk': {
      const stride = Math.sin(t * TAU * 1.75);
      pose.bodyY += Math.abs(stride) * 0.075;
      pose.headRoll = -walkDirection * 0.09;
      pose.armLeft = stride * 0.4;
      pose.armRight = -stride * 0.4;
      pose.footLeft = stride * 0.16;
      pose.footRight = -stride * 0.16;
      pose.gazeX = walkDirection * 0.08;
      pose.antenna = stride * 0.25;
      pose.shadowScale = 1 - Math.abs(stride) * 0.16;
      break;
    }
    case 'idle':
      break;
  }

  return pose;
}
