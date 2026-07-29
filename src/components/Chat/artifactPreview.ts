import type { Artifact } from '@/types/RenderBlock';

export function isPreviewableArtifact(artifact: Pick<Artifact, 'type'>): boolean {
  return artifact.type === 'html' || artifact.type === 'svg';
}

export function hasPreviewableArtifact(artifacts: readonly Pick<Artifact, 'type'>[]): boolean {
  return artifacts.some(isPreviewableArtifact);
}
