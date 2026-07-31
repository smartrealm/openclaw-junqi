import { useCallback, useEffect, useState } from 'react';

export type ComposerMenuId = 'add' | 'voice' | null;

type OpenComposerMenuId = Exclude<ComposerMenuId, null>;

export function useComposerMenu(activeSessionKey: string) {
  const [active, setActive] = useState<ComposerMenuId>(null);
  const close = useCallback(() => setActive(null), []);
  const setOpen = useCallback((menu: OpenComposerMenuId, open: boolean) => {
    setActive(open ? menu : null);
  }, []);

  useEffect(() => {
    setActive(null);
  }, [activeSessionKey]);

  return {
    active,
    setOpen,
    close,
  };
}
