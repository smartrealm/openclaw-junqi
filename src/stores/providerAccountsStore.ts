/**
 * providerAccountsStore — zustand store for per-vendor multi-account
 * support, owned by JunQi electron/services/providers/provider-store.ts.
 *
 * Storage shape (in-memory only for now; persistence is a Tauri-side
 * concern we'll wire to ~/.openclaw/provider-accounts.json):
 *
 *   accounts: ProviderAccount[]
 *   secrets:  Record<accountId, ProviderSecret>
 *
 * Why a separate store from chatStore:
 *  - chatStore gets a session-level Message[]; the accounts list is
 *    orthogonal and benefits from its own selectors
 *  - the secret store needs different access controls (UI can show
 *    masked key, but the raw key only flows to gateway on demand)
 *  - the gateway serializer projects accounts down to
 *    `models.providers.*` per session, so the API surface for the
 *    UI is distinct from chat state
 *
 * The store is currently in-memory only; persistence is out of scope
 * for this commit. When wired up, it should round-trip through
 * keychain on macOS / credential manager on Windows / libsecret on
 * Linux (matches the `secure-storage` pattern in JunQi).
 */
import { create } from 'zustand';
import {
  enforceSingleDefault,
  makeProviderAccountId,
  type ProviderAccount,
  type ProviderSecret,
} from '@/types/providerAccount';

interface ProviderAccountsState {
  accounts: ProviderAccount[];
  secrets: Record<string, ProviderSecret>;

  // ── Account CRUD ──
  /** Add a new account; auto-generates id, timestamps, isDefault=false. */
  addAccount: (init: Omit<ProviderAccount, 'id' | 'createdAt' | 'updatedAt' | 'isDefault'>) => ProviderAccount;
  /** Update mutable fields; preserves id + createdAt, bumps updatedAt. */
  updateAccount: (id: string, patch: Partial<Omit<ProviderAccount, 'id' | 'createdAt'>>) => void;
  /** Remove an account + its secret. */
  removeAccount: (id: string) => void;
  /** Set an account as the default for its vendor (demotes any prior default). */
  setDefault: (id: string) => void;
  /** Toggle enabled flag. */
  setEnabled: (id: string, enabled: boolean) => void;
  /** Get all accounts for one vendor. */
  listByVendor: (vendorId: string) => ProviderAccount[];
  /** Get the default account for a vendor, or undefined. */
  defaultFor: (vendorId: string) => ProviderAccount | undefined;

  // ── Secret CRUD (kept separate from accounts so secrets can be
  //     rotated without touching the account record) ──
  setSecret: (accountId: string, secret: ProviderSecret) => void;
  getSecret: (accountId: string) => ProviderSecret | undefined;
  deleteSecret: (accountId: string) => void;
}

export const useProviderAccountsStore = create<ProviderAccountsState>((set, get) => ({
  accounts: [],
  secrets: {},

  addAccount(init) {
    const now = new Date().toISOString();
    const account: ProviderAccount = {
      ...init,
      id: makeProviderAccountId(),
      isDefault: (init as ProviderAccount).isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({
      accounts: enforceSingleDefault([...s.accounts, account], account.vendorId),
    }));
    return account;
  },

  updateAccount(id, patch) {
    set((s) => {
      const next = s.accounts.map((a) => {
        if (a.id !== id) return a;
        return { ...a, ...patch, id: a.id, createdAt: a.createdAt, updatedAt: new Date().toISOString() };
      });
      const updated = next.find((a) => a.id === id);
      if (!updated) return s;
      return { accounts: enforceSingleDefault(next, updated.vendorId) };
    });
  },

  removeAccount(id) {
    set((s) => {
      const account = s.accounts.find((a) => a.id === id);
      if (!account) return s;
      const remaining = s.accounts.filter((a) => a.id !== id);
      const { [id]: _removed, ...secrets } = s.secrets;
      return {
        accounts: enforceSingleDefault(remaining, account.vendorId),
        secrets,
      };
    });
  },

  setDefault(id) {
    set((s) => {
      const account = s.accounts.find((a) => a.id === id);
      if (!account) return s;
      return {
        accounts: s.accounts.map((a) => ({
          ...a,
          isDefault: a.vendorId === account.vendorId ? a.id === id : a.isDefault,
        })),
      };
    });
  },

  setEnabled(id, enabled) {
    get().updateAccount(id, { enabled });
  },

  listByVendor(vendorId) {
    return get().accounts.filter((a) => a.vendorId === vendorId);
  },

  defaultFor(vendorId) {
    return get().accounts.find((a) => a.vendorId === vendorId && a.isDefault);
  },

  setSecret(accountId, secret) {
    set((s) => ({ secrets: { ...s.secrets, [accountId]: secret } }));
  },

  getSecret(accountId) {
    return get().secrets[accountId];
  },

  deleteSecret(accountId) {
    set((s) => {
      const { [accountId]: _removed, ...secrets } = s.secrets;
      return { secrets };
    });
  },
}));