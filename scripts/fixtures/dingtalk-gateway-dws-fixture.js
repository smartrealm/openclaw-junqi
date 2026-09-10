const args = process.argv.slice(2);

const schemaArgs = [
  'schema',
  'contact.get_current_user_profile',
  '--format',
  'json',
];
const businessArgs = [
  '--profile',
  'smoke:test-user',
  'contact',
  'user',
  'get-self',
  '--format',
  'json',
];

if (JSON.stringify(args) === JSON.stringify(schemaArgs)) {
  console.log(JSON.stringify({
    availability: 'available',
    canonical_path: 'contact.get_current_user_profile',
    cli_path: 'contact user get-self',
    effect: 'read',
    risk: 'low',
    confirmation: 'not_required',
    idempotency: 'idempotent',
    parameters: {},
  }));
} else if (JSON.stringify(args) === JSON.stringify(businessArgs)) {
  console.log(JSON.stringify({
    ok: true,
    outcome: 'success',
    data: {
      fixture: 'junqi-dingtalk-gateway-chain',
      userId: 'test-user',
    },
  }));
} else {
  console.error('Unsupported deterministic DingTalk Gateway fixture command');
  process.exitCode = 2;
}
