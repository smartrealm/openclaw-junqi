import { OPENCLAW_COMMANDS } from '../src/pages/OpenClawCommands/commands';

async function verifyOpenClawCommandLinks(): Promise<void> {
  const pageRequests = new Map<string, Promise<string>>();

  for (const item of OPENCLAW_COMMANDS) {
    const url = new URL(item.docsUrl);
    const pageUrl = `${url.origin}${url.pathname}`;
    let pageRequest = pageRequests.get(pageUrl);

    if (!pageRequest) {
      pageRequest = fetch(pageUrl).then(async (response) => {
        if (!response.ok) {
          throw new Error(`${pageUrl} returned HTTP ${response.status}`);
        }
        return response.text();
      });
      pageRequests.set(pageUrl, pageRequest);
    }

    const html = await pageRequest;
    if (!url.hash) continue;

    // OpenClaw's docs router decodes the hash once. Encoded slashes therefore
    // remain as %2F in the generated heading id.
    const headingId = decodeURIComponent(url.hash.slice(1));
    if (!html.includes(`id="${headingId}"`)) {
      throw new Error(`${item.id} is missing official heading #${headingId}`);
    }
  }

  console.log(`Verified ${OPENCLAW_COMMANDS.length} official OpenClaw links and anchors.`);
}

void verifyOpenClawCommandLinks().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
