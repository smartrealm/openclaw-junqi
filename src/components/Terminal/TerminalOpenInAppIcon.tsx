import { AppWindow, FolderOpen } from 'lucide-react';

export interface TerminalOpenInApp {
  id: string;
  label: string;
  iconDataUrl?: string | null;
}

/** Renders only native-resolved artwork; an unavailable icon stays generic. */
export function TerminalOpenInAppIcon({
  app,
  size,
}: {
  app: TerminalOpenInApp;
  size: number;
}) {
  if (app.iconDataUrl) {
    return (
      <img
        src={app.iconDataUrl}
        alt=""
        draggable={false}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      />
    );
  }
  if (app.id === 'finder') return <FolderOpen size={size} strokeWidth={1.8} />;
  return <AppWindow size={size} strokeWidth={1.7} />;
}
