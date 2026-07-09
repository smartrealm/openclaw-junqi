/**
 * SkinPreview — a small, faithful thumbnail of a pet skin for the settings
 * picker. It renders the real {@link PetCharacter} (idle pose, live breathing +
 * blink) scaled down, so what the user previews is exactly what floats on their
 * desktop — no separate, drift-prone thumbnail art to maintain.
 */
import { PetCharacter } from './PetCharacter';
import type { PetSkin } from './skins';

/** PetCharacter renders into a fixed 96×110 box; we scale that to fit `size`. */
const PET_W = 96;
const PET_H = 110;

export function SkinPreview({ skin, size = 48 }: { skin: PetSkin; size?: number }) {
  const scale = size / PET_H;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <div style={{ width: PET_W * scale, height: PET_H * scale, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
          <PetCharacter skin={skin} emotion="idle" />
        </div>
      </div>
    </div>
  );
}
