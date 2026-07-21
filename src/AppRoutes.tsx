import { lazy, Suspense, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useAlertStore } from '@/components/shared/alertStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useSessionMutationDialogStore } from '@/services/collaboration/sessionMutationDialogStore';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { useCollaborationSetupStore } from '@/stores/collaborationSetupStore';

const AppRouteTree = lazy(() => import('@/AppRouteTree'));
const ToastContainer = lazy(() => import('@/components/Toast/ToastContainer').then(m => ({ default: m.ToastContainer })));
const GlobalAlertDialog = lazy(() => import('@/components/shared/AlertDialog').then(m => ({ default: m.GlobalAlertDialog })));
const SessionMutationDialog = lazy(() => import('@/components/Collaboration/SessionMutationDialog').then(m => ({ default: m.SessionMutationDialog })));
const CollaborationSetupDialog = lazy(() => import('@/components/Collaboration/CollaborationSetupDialog').then(m => ({ default: m.CollaborationSetupDialog })));

function RouteLoadingFallback() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0c1015' }}>
      <div style={{ width: 32, height: 32, border: '2px solid rgba(14,165,233,0.3)', borderTopColor: '#0ea5e9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, fontFamily: 'system-ui,sans-serif' }}>Loading workspace...</span>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

function LazyToastHost() {
  const toastCount = useNotificationStore((s) => s.toasts.length);
  if (toastCount === 0) return null;
  return (
    <Suspense fallback={null}>
      <ToastContainer />
    </Suspense>
  );
}

function LazyAlertDialogHost() {
  const open = useAlertStore((s) => s.open);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <GlobalAlertDialog />
    </Suspense>
  );
}

function LazySessionMutationDialogHost() {
  const open = useSessionMutationDialogStore((state) => Boolean(state.current));
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SessionMutationDialog />
    </Suspense>
  );
}

function CollaborationSetupRuntime() {
  const open = useCollaborationSetupStore((state) => state.open);
  const identity = useCollaborationSetupStore((state) => state.identity);
  const start = useCollaborationSetupStore((state) => state.start);
  const observeCapabilities = useCollaborationSetupStore((state) => state.observeCapabilities);
  const capabilities = useCollaborationStore((state) => state.capabilities);

  useEffect(() => start(), [start]);
  useEffect(() => {
    void observeCapabilities(capabilities);
  }, [capabilities, identity?.connectionId, identity?.runtimeId, observeCapabilities]);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <CollaborationSetupDialog />
    </Suspense>
  );
}

export default function AppRoutes() {
  return (
    <HashRouter>
      <LazyToastHost />
      <ErrorBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
          <AppRouteTree />
        </Suspense>
      </ErrorBoundary>
      <LazyAlertDialogHost />
      <LazySessionMutationDialogHost />
      <CollaborationSetupRuntime />
    </HashRouter>
  );
}
