import { useCallback, useEffect, useRef, useState } from 'react';

export type ComposerMenuId = 'add' | 'voice' | null;

export function useComposerMenu(activeSessionKey: string) {
  const [active, setActive] = useState<ComposerMenuId>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setActive(null), []);

  useEffect(() => {
    if (!active) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (addRef.current?.contains(target) || voiceRef.current?.contains(target)) return;
      setActive(null);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [active]);

  useEffect(() => {
    setActive(null);
  }, [activeSessionKey]);

  return {
    active,
    setActive,
    addRef,
    voiceRef,
    close,
  };
}
