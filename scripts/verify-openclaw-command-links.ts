const OPENCLAW_GATEWAY_PROTOCOL_URL = 'https://docs.openclaw.ai/gateway/protocol';
const COMMANDS_LIST_METHOD = 'commands.list';

async function verifyOpenClawCommandProtocol(): Promise<void> {
  const response = await fetch(OPENCLAW_GATEWAY_PROTOCOL_URL);
  if (!response.ok) {
    throw new Error(`${OPENCLAW_GATEWAY_PROTOCOL_URL} returned HTTP ${response.status}`);
  }
  const page = await response.text();
  if (!page.includes(COMMANDS_LIST_METHOD)) {
    throw new Error(`${OPENCLAW_GATEWAY_PROTOCOL_URL} does not document ${COMMANDS_LIST_METHOD}`);
  }

  console.log(`Verified official OpenClaw protocol documentation for ${COMMANDS_LIST_METHOD}.`);
}

void verifyOpenClawCommandProtocol().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
