import { invoke } from '@tauri-apps/api/core';
import type { PrivacyLockSettings, PrivacyLockSnapshot } from './types';

export const getPrivacyLockStatus = () =>
  invoke<PrivacyLockSnapshot>('get_privacy_lock_status');

export const enablePrivacyLock = (pin: string, settings: PrivacyLockSettings) =>
  invoke<PrivacyLockSnapshot>('enable_privacy_lock', { request: { pin, settings } });

export const updatePrivacyLockSettings = (settings: PrivacyLockSettings) =>
  invoke<PrivacyLockSnapshot>('update_privacy_lock_settings', { settings });

export const changePrivacyLockPin = (currentPin: string, newPin: string) =>
  invoke<void>('change_privacy_lock_pin', { request: { currentPin, newPin } });

export const disablePrivacyLock = (pin: string) =>
  invoke<PrivacyLockSnapshot>('disable_privacy_lock', { request: { pin } });

export const lockPrivacyNow = () =>
  invoke<PrivacyLockSnapshot>('lock_privacy_now', { request: { reason: 'manual' } });

export const unlockPrivacyLock = (revision: number, pin: string) =>
  invoke<PrivacyLockSnapshot>('unlock_privacy_lock', { request: { revision, pin } });

export const refreshPrivacySystemAuthentication = () =>
  invoke<PrivacyLockSnapshot>('refresh_privacy_system_authentication');

export const unlockPrivacyWithSystemAuthentication = (revision: number, reason: string) =>
  invoke<PrivacyLockSnapshot>('unlock_privacy_with_system_authentication', { revision, reason });

export const focusPrivacyUnlock = () => invoke<void>('focus_privacy_unlock');
