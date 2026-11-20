// Records a page's results for replay mode (hs-replay in notes.js): the
// page in headless Chrome against a real Thunk, pressing what a reader
// starts with, and keeping Thunk's answer for every program sent.
//
//   node tools/record-replay.mjs PAGE.md [OUT.json] [THUNK_URL]
//
// OUT.json defaults to PAGE.replay.json next to the page; THUNK_URL to
// http://localhost:8123. Then build the page with the recording:
//
//   THUNK_REPLAY=PAGE.replay.json widget/build.sh PAGE.md OUT_DIR
//
// What is recorded, in this order:
//   1. the page's own tests (.attempt and .expect blocks, as in
//      tests/visual.mjs), so that a demo can show a wrong answer;
//   2. on a fresh page, Run on every block, and Check on every exercise,
//      as the page has them;
//   3. for every exercise with a solution, Check and Run with the solution.
// Record again whenever the page's code changes: a program that is not
// in the recording needs a server.
// Needs Google Chrome, pandoc, and Thunk.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scenarioFromMarkdown } from "../tests/expect.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = resolve(process.argv[2] || "");
if (!process.argv[2]) { console.error("usage: node tools/record-replay.mjs PAGE.md [OUT.json] [THUNK_URL]"); process.exit(2); }
const out = process.argv[3] || page.replace(/\.md$/, ".replay.json");
const thunk = process.argv[4] || "http://localhost:8123";
const name = basename(page, ".md");
const work = mkdtempSync(join(tmpdir(), "thunk-replay-")), site = join(work, "site");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

execFileSync(join(root, "widget/build.sh"), [page, site, thunk],
  { stdio: "ignore", env: { ...process.env, THUNK_REPLAY: "", HINT_URL: "", EVENTS_URL: "" } });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  try {
    const path = decodeURIComponent(req.url.split("?")[0]);
    const body = readFileSync(join(site, path));
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const url = `http://127.0.0.1:${server.address().port}/${name}.html`;

const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`,
  "--user-data-dir=" + mkdtempSync(join(tmpdir(), "cdp-")), "about:blank",
], { stdio: "ignore" });
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});
const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

// Every answer from Thunk, in order, kept in the page until collected.
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source:
  "window.thunkRecorder = (code, answer) => (window.thunkRecorded = window.thunkRecorded || []).push([code, answer]);" });
const results = {};
const collect = async () => {
  for (const [code, answer] of (await evaluate("window.thunkRecorded || []"))) results[code] = answer;
};
async function load() {
  await collect();
  await send("Page.navigate", { url });
  await sleep(300);
  await evaluate("localStorage.clear()");
  await send("Page.navigate", { url });
  for (let t = 0; t < 80; t++) {
    await sleep(100);
    if (await evaluate("document.querySelectorAll('.hs-block .CodeMirror').length > 0")) break;
  }
}
const blocks = () => evaluate("document.querySelectorAll('.hs-block').length");
const setCode = (i, code) => evaluate(`document.querySelectorAll('.hs-block')[${i}].hs.setCode(${JSON.stringify(code)})`);
const has = (i, label) => evaluate(`[...document.querySelectorAll('.hs-block')[${i}].querySelectorAll('button')]
  .some((x) => x.textContent === ${JSON.stringify(label)})`);
const solution = (i) => evaluate(`(document.querySelectorAll('.hs-block')[${i}].querySelector('textarea.hs-solution') || {}).value`);
const press = (i, label) => evaluate(`(async () => {
  const b = document.querySelectorAll('.hs-block')[${i}];
  const btn = [...b.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(label)});
  if (!btn) return false;
  btn.click();
  for (let t = 0; t < 600; t++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!btn.disabled) return true;
  }
  return false;
})()`);
const log = (s) => console.log("  " + s);

console.log(`== ${name}: the page's own tests`);
await load();
for (const step of scenarioFromMarkdown(page).steps) {
  if (step.code !== undefined) await setCode(step.block, step.code);
  await press(step.block, step.click);
  log(`block ${step.block + 1}: ${step.click}${step.code !== undefined ? " (attempt)" : ""}`);
}

console.log(`== ${name}: Run and Check as the page has them`);
await load();
const n = await blocks();
for (let i = 0; i < n; i++)
  for (const label of ["Run", "Check"])
    if (await has(i, label)) { await press(i, label); log(`block ${i + 1}: ${label}`); }

console.log(`== ${name}: the solutions`);
for (let i = 0; i < n; i++) {
  const sol = await solution(i);
  if (sol === undefined) continue;
  await setCode(i, sol);
  for (const label of ["Check", "Run"])
    if (await has(i, label)) { await press(i, label); log(`block ${i + 1}: ${label} (solution)`); }
  await press(i, "Reset");
}
await collect();

ws.close(); chrome.kill(); server.close();
rmSync(work, { recursive: true, force: true });
const failed = Object.values(results).filter((a) => a.err).length;
writeFileSync(out, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), results }, null, 1) + "\n");
console.log(`wrote ${out}: ${Object.keys(results).length} programs` + (failed ? `, ${failed} of them with Thunk errors` : ""));
