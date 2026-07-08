import { lazy, Suspense } from 'react';
import { HashRouter } from 'react-router-dom';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useAlertStore } from '@/components/shared/alertStore';
import { useNotificationStore } from '@/stores/notificationStore';

const AppRouteTree = lazy(() => import('@/AppRouteTree'));
const ToastContainer = lazy(() => import('@/components/Toast/ToastContainer').then(m => ({ default: m.ToastContainer })));
const GlobalAlertDialog = lazy(() => import('@/components/shared/AlertDialog').then(m => ({ default: m.GlobalAlertDialog })));

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
    </HashRouter>
  );
}
