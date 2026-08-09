import { lazy, Suspense, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useAlertStore } from '@/components/shared/alertStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useSessionMutationDialogStore } from '@/stores/sessionMutationDialogStore';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { useCollaborationSetupStore } from '@/stores/collaborationSetupStore';
import { AppLoadingFallback } from '@/components/shared/AppLoadingFallback';
import { CollaborationActivityRuntime } from '@/runtime/CollaborationActivityRuntime';

const AppRouteTree = lazy(() => import('@/AppRouteTree'));
const ToastContainer = lazy(() => import('@/components/Toast/ToastContainer').then(m => ({ default: m.ToastContainer })));
const GlobalAlertDialog = lazy(() => import('@/components/shared/AlertDialog').then(m => ({ default: m.GlobalAlertDialog })));
const SessionMutationDialog = lazy(() => import('@/runtime/SessionMutationDialog').then(m => ({ default: m.SessionMutationDialog })));
const CollaborationSetupDialog = lazy(() => import('@/components/Collaboration/CollaborationSetupDialog').then(m => ({ default: m.CollaborationSetupDialog })));

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
      <CollaborationActivityRuntime />
      <LazyToastHost />
      <ErrorBoundary>
        <Suspense fallback={<AppLoadingFallback />}>
          <AppRouteTree />
        </Suspense>
      </ErrorBoundary>
      <LazyAlertDialogHost />
      <LazySessionMutationDialogHost />
      <CollaborationSetupRuntime />
    </HashRouter>
  );
}
