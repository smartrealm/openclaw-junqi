import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { ManagedFilePreview } from './ManagedFilePreview';

const i18n = createInstance();
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  showSupportNotice: false,
});

function renderPreview(preview: ReactElement): string {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{preview}</I18nextProvider>);
}

test('managed Markdown files use the shared safe renderer', () => {
  const html = renderPreview(
    <ManagedFilePreview
      fileName="README.md"
      preview={{
        kind: 'markdown',
        content: '# Overview\n\n<script>alert(1)</script>',
        truncated: false,
      }}
    />,
  );
  assert.match(html, /id="overview"/);
  assert.doesNotMatch(html, /<script>/);
});

test('managed JSON files format valid content and preserve invalid source', () => {
  const formatted = renderPreview(
    <ManagedFilePreview
      fileName="config.json"
      preview={{ kind: 'json', content: '{"enabled":true,"count":2}', truncated: false }}
    />,
  );
  assert.match(formatted, /\{\n  &quot;enabled&quot;: true,\n  &quot;count&quot;: 2\n\}/);

  const invalid = renderPreview(
    <ManagedFilePreview
      fileName="config.json"
      preview={{ kind: 'json', content: '{"enabled":', truncated: false }}
    />,
  );
  assert.match(invalid, /Invalid JSON\. Showing the original content\./);
  assert.match(invalid, /\{&quot;enabled&quot;:/);

  const truncated = renderPreview(
    <ManagedFilePreview
      fileName="config.json"
      preview={{ kind: 'json', content: '{"enabled":', truncated: true }}
    />,
  );
  assert.doesNotMatch(truncated, /Invalid JSON/);
  assert.match(truncated, /This preview is truncated/);
});

test('managed HTML keeps interactive scripts scoped and static HTML scriptless', () => {
  const interactive = renderPreview(
    <ManagedFilePreview
      fileName="index.html"
      preview={{ kind: 'html', mode: 'interactive', url: 'junqi-preview://localhost/token/index.html' }}
    />,
  );
  const staticPreview = renderPreview(
    <ManagedFilePreview
      fileName="index.html"
      preview={{ kind: 'html', mode: 'static', content: '<script>alert(1)</script>', truncated: false }}
    />,
  );
  assert.match(interactive, /sandbox="allow-scripts"/);
  assert.match(interactive, /junqi-preview:\/\/localhost\/token\/index\.html/);
  assert.match(staticPreview, /srcDoc="&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(staticPreview, /sandbox=""/);
});

test('managed media files share the same image, audio and video surface', () => {
  const image = renderPreview(
    <ManagedFilePreview fileName="image.png" preview={{ kind: 'image', url: 'preview:image' }} />,
  );
  const audio = renderPreview(
    <ManagedFilePreview fileName="audio.m4a" preview={{ kind: 'audio', url: 'preview:audio' }} />,
  );
  const video = renderPreview(
    <ManagedFilePreview fileName="video.webm" preview={{ kind: 'video', url: 'preview:video' }} />,
  );
  assert.match(image, /<img/);
  assert.match(audio, /<audio/);
  assert.match(video, /<video/);
});
