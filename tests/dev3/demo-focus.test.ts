import assert from "node:assert/strict";
import test from "node:test";
import { keepFocus } from "../../src/features/builder/demo/focus.js";
import { createDemoServer } from "../../src/features/builder/demo/server.mjs";

test("restores the focused block control after it is replaced during render", () => {
  const old = {dataset: {focusKey: "title:buy"}};
  const root = {activeElement: old as unknown, querySelectorAll: () => [replacement]};
  const replacement = {dataset: {focusKey: "title:buy"}, focus() { root.activeElement = this; }};
  keepFocus(root, () => { root.activeElement = null; });
  assert.equal(root.activeElement, replacement);
});

test("keeps the text selection when a focused settings input is replaced", () => {
  const old = {dataset: {focusKey: "setting:threshold"}, selectionStart: 1, selectionEnd: 2};
  const root = {activeElement: old as unknown, querySelectorAll: () => [replacement]};
  const replacement = {
    dataset: {focusKey: "setting:threshold"}, selection: [] as number[],
    focus() { root.activeElement = this; },
    setSelectionRange(start: number, end: number) { this.selection = [start, end]; },
  };
  keepFocus(root, () => { root.activeElement = null; });
  assert.equal(root.activeElement, replacement);
  assert.deepEqual(replacement.selection, [1, 2]);
});

test("malformed request targets return 400 rather than rejecting the request handler", async () => {
  const server = createDemoServer();
  const handler = server.listeners("request")[0]!;
  let status;
  const response = {setHeader() {}, writeHead(code: number) {status = code; return this;}, end() {}};
  await handler({method: "GET", url: "//[", headers: {host: "127.0.0.1:4317"}}, response);
  assert.equal(status, 400);
});
