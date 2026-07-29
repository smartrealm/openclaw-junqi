import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveMarkdownResourcePath,
  workspaceRelativePath,
} from "./fileViewerModel";

test("workspace-relative paths preserve POSIX case and normalize Windows separators", () => {
  assert.equal(workspaceRelativePath("/repo/docs/README.md", "/repo"), "docs/README.md");
  assert.equal(workspaceRelativePath("/Repo/docs/README.md", "/repo"), "/Repo/docs/README.md");
  assert.equal(
    workspaceRelativePath("C:\\Repo\\docs\\README.md", "c:\\repo"),
    "docs/README.md",
  );
});

test("markdown resources resolve only inside the selected workspace", () => {
  assert.equal(
    resolveMarkdownResourcePath("../assets/diagram.png", "/repo/docs/README.md", "/repo"),
    "/repo/assets/diagram.png",
  );
  assert.equal(
    resolveMarkdownResourcePath("/assets/diagram.png", "/repo/docs/README.md", "/repo"),
    "/repo/assets/diagram.png",
  );
  assert.equal(
    resolveMarkdownResourcePath("../assets/my%20diagram.png", "/repo/docs/README.md", "/repo"),
    "/repo/assets/my diagram.png",
  );
  assert.equal(
    resolveMarkdownResourcePath(
      "..\\assets\\diagram.png",
      "C:\\Repo\\docs\\README.md",
      "c:\\repo",
    ),
    "C:\\Repo\\assets\\diagram.png",
  );
  assert.equal(resolveMarkdownResourcePath("../../secret.png", "/repo/README.md", "/repo"), null);
  assert.equal(resolveMarkdownResourcePath("https://example.com/a.png", "/repo/README.md", "/repo"), null);
  assert.equal(resolveMarkdownResourcePath("bad%2.png", "/repo/README.md", "/repo"), null);
});
