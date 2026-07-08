/// <reference types="vite/client" />

// Injected by Vite define plugin (from package.json version)
declare const __APP_VERSION__: string;

declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url' {
  const workerUrl: string;
  export default workerUrl;
}

declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}
