import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import { debugWarn } from '@/utils/debugLog';
import { hasTauriEventBridge, subscribeTauriListener } from '@/utils/tauriEvents';

export function viewerSessionKeys(input: {
  setupComplete: boolean;
  connected: boolean;
  focused: boolean;
  activeSessionKey: string;
}): string[] {
  const sessionKey = input.activeSessionKey.trim();
  return input.setupComplete && input.connected && input.focused && sessionKey ? [sessionKey] : [];
}

/** 仅由桌面主窗口焦点声明当前实际渲染的 OpenClaw 会话。 */
export default function OpenClawSessionViewerPresenceRuntime({
  setupComplete,
}: {
  setupComplete: boolean;
}) {
  const connected = useChatStore((state) => state.connected);
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!hasTauriEventBridge()) return;
    let active = true;
    const mainWindow = getCurrentWindow();
    const refresh = () => {
      void mainWindow.isFocused()
        .then((nextFocused) => { if (active) setFocused(nextFocused); })
        .catch(() => { if (active) setFocused(false); });
    };
    refresh();
    const unlisten = subscribeTauriListener(
      () => mainWindow.onFocusChanged(refresh),
      () => { if (active) setFocused(false); },
    );
    return () => {
      active = false;
      unlisten();
      void gateway.setVisibleSessionKeys([]).catch((error) => {
        debugWarn('gateway', '[ViewerPresence] Unable to clear viewer declaration:', error);
      });
    };
  }, []);

  useEffect(() => {
    const sessionKeys = viewerSessionKeys({ setupComplete, connected, focused, activeSessionKey });
    void gateway.setVisibleSessionKeys(sessionKeys).catch((error) => {
      debugWarn('gateway', '[ViewerPresence] Unable to update viewer declaration:', error);
    });
  }, [activeSessionKey, connected, focused, setupComplete]);

  return null;
}
