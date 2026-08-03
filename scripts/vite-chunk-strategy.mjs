const PACKAGE_CHUNKS = [
  {
    chunk: "react-vendor",
    packages: [
      "react",
      "react-dom",
      "scheduler",
      "use-sync-external-store",
    ],
  },
  { chunk: "i18n-vendor", packages: ["i18next", "react-i18next"] },
  { chunk: "pdfjs", packages: ["pdfjs-dist"] },
  { chunk: "xterm-core", packages: ["@xterm/xterm"] },
  {
    chunk: "xterm-addons",
    packages: [
      "@xterm/addon-fit",
      "@xterm/addon-search",
      "@xterm/addon-serialize",
      "@xterm/addon-unicode11",
      "@xterm/addon-webgl",
    ],
  },
  {
    chunk: "codemirror-ui",
    packages: ["@uiw/react-codemirror", "@uiw/codemirror"],
  },
  { chunk: "codemirror-core", packages: ["@codemirror"] },
  { chunk: "charts-recharts", packages: ["recharts"] },
  { chunk: "motion", packages: ["framer-motion"] },
  { chunk: "icons", packages: ["@phosphor-icons"] },
  { chunk: "dnd", packages: ["@dnd-kit"] },
  { chunk: "syntax-highlighter", packages: ["react-syntax-highlighter"] },
  { chunk: "markdown", packages: ["react-markdown", "remark-gfm"] },
];

export const JAVASCRIPT_CHUNK_BUDGET_KB = 550;

function packagePathMatches(moduleId, packageName) {
  const packagePath = `/node_modules/${packageName}`;
  return (
    moduleId.includes(`${packagePath}/`) ||
    moduleId.endsWith(packagePath)
  );
}

function codeMirrorLanguageChunk(moduleId) {
  const match = moduleId.match(
    /\/node_modules\/@codemirror\/(?:lang-([^/]+)|legacy-modes\/mode\/([^/.]+))(?=\/|\.[mc]?[jt]s$)/,
  );
  const language = match?.[1] ?? match?.[2];
  return language ? `cm-lang-${language}` : undefined;
}

function d3Chunk(moduleId) {
  const match = moduleId.match(/\/node_modules\/(d3-[^/]+)(?=\/|$)/);
  return match ? `charts-${match[1]}` : undefined;
}

/**
 * Keep manual chunks limited to third-party package boundaries. Application
 * modules are deliberately left to Rollup's graph-based splitting so a new
 * internal import cannot create circular chunks or inflate a shared core.
 */
export function resolveManualChunk(rawModuleId) {
  const moduleId = rawModuleId.replaceAll("\\", "/");
  if (!moduleId.includes("/node_modules/")) return undefined;

  const codeMirrorLanguage = codeMirrorLanguageChunk(moduleId);
  if (codeMirrorLanguage) return codeMirrorLanguage;

  if (packagePathMatches(moduleId, "@codemirror/legacy-modes")) {
    return "cm-lang";
  }

  const d3 = d3Chunk(moduleId);
  if (d3) return d3;

  const group = PACKAGE_CHUNKS.find(({ packages }) =>
    packages.some((packageName) => packagePathMatches(moduleId, packageName)),
  );
  return group?.chunk;
}

export function failOnCircularChunk(warning, defaultHandler) {
  if (warning.code === "CIRCULAR_CHUNK") {
    throw new Error(warning.message);
  }
  defaultHandler(warning);
}

export function assertJavaScriptChunkBudget(
  bundle,
  budgetKb = JAVASCRIPT_CHUNK_BUDGET_KB,
) {
  const budgetBytes = budgetKb * 1000;
  const oversizedChunks = Object.values(bundle)
    .filter((output) => output.type === "chunk")
    .map((chunk) => ({
      fileName: chunk.fileName,
      sizeBytes: Buffer.byteLength(chunk.code),
    }))
    .filter(({ sizeBytes }) => sizeBytes > budgetBytes)
    .sort((left, right) => right.sizeBytes - left.sizeBytes);

  if (oversizedChunks.length === 0) return;

  const details = oversizedChunks
    .map(
      ({ fileName, sizeBytes }) =>
        `${fileName} (${(sizeBytes / 1000).toFixed(2)} kB)`,
    )
    .join(", ");
  throw new Error(
    `JavaScript chunk budget exceeded (${budgetKb} kB): ${details}`,
  );
}

export function enforceJavaScriptChunkBudget() {
  return {
    name: "junqi-javascript-chunk-budget",
    apply: "build",
    enforce: "post",
    generateBundle(_outputOptions, bundle) {
      assertJavaScriptChunkBudget(bundle);
    },
  };
}
