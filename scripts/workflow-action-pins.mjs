/**
 * Reviewed immutable action identities used by repository workflows.
 * Updating a pin is an explicit supply-chain change and must be reviewed with
 * the corresponding upstream release notes and digest.
 */
export const WORKFLOW_ACTION_PINS = Object.freeze({
  'actions/checkout': '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
  'pnpm/action-setup': '0ebf47130e4866e96fce0953f49152a61190b271',
  'actions/setup-node': '249970729cb0ef3589644e2896645e5dc5ba9c38',
  'actions/upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  'actions/download-artifact': '37930b1c2abaa49bbe596cd826c3c89aef350131',
  'actions/attest': 'f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6',
  'dtolnay/rust-toolchain': '4cda84d5c5c54efe2404f9d843567869ab1699d4',
  'Swatinem/rust-cache': 'e18b497796c12c097a38f9edb9d0641fb99eee32',
  'tauri-apps/tauri-action': '1deb371b0cd8bd54025b384f1cd735e725c4060f',
});

export function requireReviewedActionPin(action) {
  const pin = WORKFLOW_ACTION_PINS[action];
  if (!pin) throw new Error(`Unreviewed workflow action: ${action}`);
  return pin;
}
