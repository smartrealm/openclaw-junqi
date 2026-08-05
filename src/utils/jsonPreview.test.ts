import assert from "node:assert/strict";
import test from "node:test";
import { formatJsonPreview } from "./jsonPreview";

test("JSON 预览格式化嵌套结构并保留数字和字符串字面量", () => {
  const source = '{"id":9007199254740993,"ratio":1.20e+3,"items":[true,null,{"escaped":"a\\\\b"}]}';

  assert.equal(formatJsonPreview(source), [
    "{",
    '  "id": 9007199254740993,',
    '  "ratio": 1.20e+3,',
    '  "items": [',
    "    true,",
    "    null,",
    "    {",
    '      "escaped": "a\\\\b"',
    "    }",
    "  ]",
    "}",
  ].join("\n"));
});

test("JSON 预览拒绝不完整内容并由调用方保留原文", () => {
  assert.equal(formatJsonPreview('{"enabled":'), null);
  assert.equal(formatJsonPreview('{"enabled":true,}'), null);
});

test("JSON 预览对深层结构保留原文并限制格式化膨胀", () => {
  const depth = 10_000;
  const source = `${"[".repeat(depth)}{}${"]".repeat(depth)}`;

  assert.equal(formatJsonPreview(source), source);
});
