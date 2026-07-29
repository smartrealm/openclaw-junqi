import assert from "node:assert/strict";
import test from "node:test";
import en from "./en.json";
import zhTW from "./zh-TW.json";
import zh from "./zh.json";

test("Git change controls have the same complete key set in every locale", () => {
  const expectedKeys = Object.keys(en.gitChanges).sort();

  for (const locale of [zh, zhTW]) {
    assert.deepEqual(Object.keys(locale.gitChanges).sort(), expectedKeys);
    for (const value of Object.values(locale.gitChanges)) {
      assert.notEqual(value.trim(), "");
    }
  }
});

test("Git history controls have the same complete key set in every locale", () => {
  const expectedKeys = Object.keys(en.gitHistory).sort();

  for (const locale of [zh, zhTW]) {
    assert.deepEqual(Object.keys(locale.gitHistory).sort(), expectedKeys);
    for (const value of Object.values(locale.gitHistory)) {
      assert.notEqual(value.trim(), "");
    }
  }
});

test("Git diff controls have the same complete key set in every locale", () => {
  const expectedKeys = Object.keys(en.gitDiff).sort();

  for (const locale of [zh, zhTW]) {
    assert.deepEqual(Object.keys(locale.gitDiff).sort(), expectedKeys);
    for (const value of Object.values(locale.gitDiff)) {
      assert.notEqual(value.trim(), "");
    }
  }
});
