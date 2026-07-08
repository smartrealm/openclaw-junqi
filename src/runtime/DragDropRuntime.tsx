import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { combineUnlisteners, subscribeTauriEvent } from '@/utils/tauriEvents';
import { debugLog } from '@/utils/debugLog';

async function playPetSfxLazy(name: 'drag' | 'drop' | 'munch', enabled: boolean) {
  const mod = await import('@/pet/petSounds');
  return mod.playPetSfx(name, enabled);
}

export default function DragDropRuntime() {
  const [draggingOver, setDraggingOver] = useState(false);
  const [draggedPaths, setDraggedPaths] = useState<string[]>([]);
  const dragSfxStop = useRef<null | (() => void)>(null);
  const dragSfxToken = useRef(0);

  useEffect(() => {
    const unlisten = combineUnlisteners([
      subscribeTauriEvent<string[]>('aegis:file-dropped', async (e) => {
        debugLog('app', '[aegis] file-dropped', e.payload);
        const paths = e.payload ?? [];
        if (paths.length === 0) return;

        const cs = useChatStore.getState();
        const newKey = `agent:main:s-${Date.now().toString(36).slice(-5)}`;
        cs.addLocalSession({
          key: newKey,
          label: paths.length === 1
            ? `📎 ${paths[0].split(/[\\/]/).pop()}`
            : `📎 ${paths.length} 个文件`,
          agentId: 'main',
          createdAt: Date.now(),
        } as any);
        cs.setActiveSession(newKey);
        cs.setPendingFiles(paths);
        window.dispatchEvent(new CustomEvent('aegis:files-dropped', { detail: { paths, sessionKey: newKey } }));

        const url = new URL(window.location.href);
        url.hash = `#/chat?session=${encodeURIComponent(newKey)}`;
        window.history.replaceState({}, '', url.toString());
        window.dispatchEvent(new PopStateEvent('popstate'));

        dragSfxToken.current += 1;
        dragSfxStop.current?.();
        dragSfxStop.current = null;
        const soundOn = useSettingsStore.getState().soundEnabled;
        void playPetSfxLazy('drop', soundOn);
        void playPetSfxLazy('munch', soundOn);

        window.dispatchEvent(new CustomEvent('aegis:pet-swallow', {
          detail: { count: paths.length },
        }));
        usePetStore.getState().bumpSwallowTick();
        usePetStore.getState().setDragActive(false);
        setDraggingOver(false);
      }),
      subscribeTauriEvent<string[]>('aegis:drag-active', (e) => {
        debugLog('app', '[aegis] drag-active', e.payload);
        const paths = e.payload ?? [];
        setDraggingOver(true);
        setDraggedPaths(paths);
        usePetStore.getState().setDragActive(true, paths);

        const token = dragSfxToken.current + 1;
        dragSfxToken.current = token;
        dragSfxStop.current?.();
        dragSfxStop.current = null;
        void playPetSfxLazy('drag', useSettingsStore.getState().soundEnabled).then((stop) => {
          if (dragSfxToken.current !== token) {
            stop?.();
            return;
          }
          dragSfxStop.current = stop ?? null;
        });
      }),
      subscribeTauriEvent('aegis:drag-inactive', () => {
        debugLog('app', '[aegis] drag-inactive');
        dragSfxToken.current += 1;
        setDraggingOver(false);
        setDraggedPaths([]);
        usePetStore.getState().setDragActive(false);
        usePetStore.getState().setDragOver(false);
        dragSfxStop.current?.();
        dragSfxStop.current = null;
      }),
      subscribeTauriEvent<boolean>('aegis:drag-over-main', (e) => {
        usePetStore.getState().setDragOver(e.payload ?? false);
      }),
    ]);
    return () => {
      unlisten();
      dragSfxToken.current += 1;
      dragSfxStop.current?.();
      dragSfxStop.current = null;
    };
  }, []);

  if (!draggingOver) return null;
  return (
    <div
      className="fixed inset-0 z-[9998] pointer-events-none flex items-center justify-center"
      style={{ animation: 'fadeIn 120ms ease-out' }}
    >
      <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-aegis-primary/60 bg-aegis-primary/[0.06] backdrop-blur-sm" />
      <div className="relative flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-black/40 border border-aegis-primary/30">
        <div className="text-aegis-primary text-[14px] font-semibold tracking-wide">
          拖入到 JunQi Quick Chat
        </div>
        <div className="text-aegis-text-dim text-[11px]">
          {draggedPaths.length} 项，松开会单独打开会话
        </div>
        <div className="flex flex-wrap gap-1.5 max-w-[420px] mt-1 justify-center">
          {draggedPaths.slice(0, 6).map((p, i) => (
            <span key={i} className="px-2 py-0.5 rounded bg-white/10 border border-white/10 text-[10.5px] truncate max-w-[180px]">
              {p.split('/').pop() || p}
            </span>
          ))}
          {draggedPaths.length > 6 && (
            <span className="px-2 py-0.5 rounded bg-white/10 border border-white/10 text-[10.5px]">
              +{draggedPaths.length - 6}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
