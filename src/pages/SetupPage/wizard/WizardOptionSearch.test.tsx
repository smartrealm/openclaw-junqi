import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OpenClawWizardOption } from "@/services/openclawWizard";
import {
  filterWizardOptions,
  shouldSearchWizardOptions,
  WizardOptionSearch,
} from "./WizardOptionSearch";

const options: OpenClawWizardOption[] = [
  { value: "openai", label: "OpenAI", hint: "API key or account authorization" },
  { value: "anthropic", label: "Anthropic", hint: "Claude models" },
  { value: "custom-provider", label: "自定义供应商", hint: "OpenAI-compatible endpoint" },
];

test("长选项集合才显示通用搜索入口", () => {
  assert.equal(shouldSearchWizardOptions(options), false);
  assert.equal(shouldSearchWizardOptions([
    ...options,
    { value: "google", label: "Google" },
    { value: "minimax", label: "MiniMax" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "more", label: "More" },
  ]), true);
});

test("搜索匹配官方标签、提示和字符串值且保留原始索引", () => {
  assert.deepEqual(filterWizardOptions(options, "claude"), [
    { option: options[1], originalIndex: 1 },
  ]);
  assert.deepEqual(filterWizardOptions(options, "custom-provider"), [
    { option: options[2], originalIndex: 2 },
  ]);
  assert.deepEqual(filterWizardOptions(options, "  OPENAI  "), [
    { option: options[0], originalIndex: 0 },
    { option: options[2], originalIndex: 2 },
  ]);
});

test("空搜索返回全部官方选项且不改写值", () => {
  const result = filterWizardOptions(options, "  ");

  assert.deepEqual(result.map((item) => item.option), options);
  assert.deepEqual(result.map((item) => item.originalIndex), [0, 1, 2]);
});

test("长选项集合渲染可访问的搜索框和受控滚动区域", () => {
  const longOptions = [
    ...options,
    { value: "google", label: "Google" },
    { value: "minimax", label: "MiniMax" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "more", label: "More" },
  ];
  const html = renderToStaticMarkup(
    <WizardOptionSearch
      stepId="provider-choice"
      options={longOptions}
      t={((key: string) => key) as never}
      renderOptions={(items) => items.map(({ option }) => option.label).join(",")}
    />,
  );

  assert.match(html, /type="search"/);
  assert.match(html, /aria-label="setup\.wizard\.searchOptions"/);
  assert.match(html, /overflow-y-auto/);
});

test("官方未返回选项时不伪装成搜索无结果", () => {
  const html = renderToStaticMarkup(
    <WizardOptionSearch
      stepId="empty-choice"
      options={[]}
      t={((key: string) => key) as never}
      renderOptions={() => null}
    />,
  );

  assert.match(html, /setup\.wizard\.noOptionsAvailable/);
  assert.doesNotMatch(html, /type="search"/);
  assert.doesNotMatch(html, /setup\.wizard\.noMatchingOptions/);
});
