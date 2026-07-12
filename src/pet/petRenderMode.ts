import type { CustomPetPackage } from '@/stores/petStore';

export type PetRenderMode = 'three' | 'sprite' | 'svg';

/**
 * Keep custom artwork on its proven render paths. The built-in companion is
 * the only renderer that requires WebGL, so a driver/context failure degrades
 * cleanly to the existing SVG character instead of replacing the whole window.
 */
export function resolvePetRenderMode(input: {
  customAsset?: string | null;
  customPet?: CustomPetPackage | null;
  webglAvailable: boolean;
}): PetRenderMode {
  if (input.customPet) return 'sprite';
  if (input.customAsset) return 'svg';
  return input.webglAvailable ? 'three' : 'svg';
}
