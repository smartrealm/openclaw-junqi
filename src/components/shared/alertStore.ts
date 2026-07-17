import { create } from 'zustand';
import i18n from '@/i18n';

export type AlertVariant = 'info' | 'warning' | 'error' | 'success' | 'confirm';

interface AlertState {
  open: boolean;
  title: string;
  message: string;
  variant: AlertVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void | Promise<void>;
}

export const useAlertStore = create<AlertState & {
  alert: (params: Omit<AlertState, 'open'>) => void;
  confirm: (params: Omit<AlertState, 'open' | 'variant'> & { variant?: AlertVariant }) => void;
  close: () => void;
}>(set => ({
  open: false,
  title: '',
  message: '',
  variant: 'info',
  alert: (params) => set({ ...params, open: true, confirmLabel: undefined, onConfirm: undefined }),
  confirm: (params) => set({ ...params, open: true }),
  close: () => set({ open: false }),
}));

export function showAlert(title: string, message: string, variant: AlertVariant = 'info') {
  useAlertStore.getState().alert({ title, message, variant });
}

export function showConfirm(title: string, message: string, onConfirm: () => void | Promise<void>) {
  useAlertStore.getState().confirm({
    title,
    message,
    variant: 'confirm',
    confirmLabel: i18n.t('common.confirm') as string,
    onConfirm,
  });
}
