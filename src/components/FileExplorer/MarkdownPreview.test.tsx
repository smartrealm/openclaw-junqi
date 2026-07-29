import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { extractMarkdownHeadings, MarkdownPreview } from "./MarkdownPreview";

test("markdown preview renders GFM content and stable heading anchors", () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview
      content={[
        "# Overview",
        "",
        "- [x] shipped",
        "",
        "| Name | State |",
        "| --- | --- |",
        "| Preview | Ready |",
        "",
        "<script>alert('unsafe')</script>",
      ].join("\n")}
    />,
  );

  assert.match(html, /id="overview"/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script>/);
});

test("markdown outline ignores headings inside fenced code", () => {
  assert.deepEqual(
    extractMarkdownHeadings([
      "# Visible",
      "```md",
      "## Not a heading",
      "```",
      "Setext heading",
      "---",
    ].join("\n")),
    [
      { depth: 1, id: "visible", text: "Visible" },
      { depth: 2, id: "setext-heading", text: "Setext heading" },
    ],
  );
});

test("markdown headings keep Unicode anchors and disambiguate duplicates", () => {
  const content = ["# 设置", "", "## **设置**", "", "[设置](#设置)"].join("\n");

  assert.deepEqual(extractMarkdownHeadings(content), [
    { depth: 1, id: "设置", text: "设置" },
    { depth: 2, id: "设置-1", text: "设置" },
  ]);

  const html = renderToStaticMarkup(<MarkdownPreview content={content} />);
  assert.match(html, /id="设置"/);
  assert.match(html, /id="设置-1"/);
  assert.match(html, /href="#%E8%AE%BE%E7%BD%AE"/);
  assert.doesNotMatch(html, /node="/);
});
