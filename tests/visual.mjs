// Visual test of the demo pages in headless Chrome.
//
//   node tests/visual.mjs [OUTDIR]
//
// Builds the pages in PAGE_DIRS (default "demo tests/pages"), serves
// them, and runs the steps in scenarios.mjs and the tests written in the
// pages (.expect blocks, see expect.mjs):
// each step can set a block's code, click a button, check the output
// against a pattern, and save a screenshot of the block. At the end each
// page is also saved whole, in light and dark, and at phone width.
// Every scenario runs twice: in the page's own layout and with
// ?layout=classic. Finally, on every page, each exercise's solution must
// pass its tests.
// Needs Google Chrome, pandoc, and Thunk on localhost:8123.
// Exits with 1 if a check failed.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { scenarios } from "./scenarios.mjs";
import { scenarioFromMarkdown, normalise } from "./expect.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = process.argv[2] || join(root, "_shots");
const site = join(root, "_site");
mkdirSync(outdir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The hint service (hints/server.py) with a mock model, for the demo
// page only.
// It also counts the button presses (EVENT_LOG) on every page.
const hintPort = 18125;
const eventLog = join(mkdtempSync(join(tmpdir(), "events-")), "events.jsonl");
const hints = spawn("python3", [join(root, "hints/server.py")], {
  env: { ...process.env, PORT: String(hintPort), HINT_PROVIDER: "mock", HINT_ORIGINS: "http://127.0.0.1:*",
    EVENT_LOG: eventLog,
    HINT_PER_MINUTE: "100", HINT_PER_DAY: "1000",
    HINT_MOCK_ANSWER: "Look at the counterexample: what does your `count` give for **it**? <b>x</b>\n\n- one\n- two" },
  stdio: "ignore",
});

// PAGE_DIRS: folders of pages, relative to the current directory (or
// this repo's root for the defaults). "dir=sub" puts a folder's pages in
// _site/sub/ (for pages with the same names). Files named in capitals
// (README.md) are not pages. HINT_DIRS: the folders whose pages get the
// hint service (default "demo").
const pageDirs = (process.env.PAGE_DIRS || "demo tests/pages").split(/\s+/).filter(Boolean).map((d) => {
  const [dir, sub = ""] = d.split("=");
  return { dir: process.env.PAGE_DIRS ? join(process.cwd(), dir) : join(root, dir), name: dir, sub };
});
const hintDirs = (process.env.HINT_DIRS || "demo").split(/\s+/);
const isPage = (f) => f.endsWith(".md") && !/^[A-Z0-9_-]+\.md$/.test(f);
for (const { dir, name, sub } of pageDirs)
  for (const f of readdirSync(dir).filter(isPage))
    execFileSync(join(root, "widget/build.sh"), [join(dir, f), join(site, sub)], {
      stdio: "ignore",
      env: { ...process.env, HINT_URL: hintDirs.includes(name) ? `http://127.0.0.1:${hintPort}` : "",
        EVENTS_URL: `http://127.0.0.1:${hintPort}` },
    });

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
const base = `http://127.0.0.1:${server.address().port}/`;

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, "--window-size=900,1200",
  "--user-data-dir=" + mkdtempSync(join(tmpdir(), "cdp-")), "about:blank",
], { stdio: "ignore" });
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
  catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Runtime.exceptionThrown")
    console.log("  [page exception]", msg.params.exceptionDetails.exception?.description);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});
const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const save = (name, data) => writeFileSync(join(outdir, name + ".png"), Buffer.from(data, "base64"));
const setWidth = (width) =>
  send("Emulation.setDeviceMetricsOverride", { width, height: 1200, deviceScaleFactor: 1, mobile: width < 600 });
const setDark = (dark) =>
  send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });

// Chrome repeats the top of the page in screenshots taller than about
// 16000 pixels, so a long page is saved in parts: NAME-1, NAME-2, ...
async function shotPage(name) {
  const height = await evaluate("document.documentElement.scrollHeight");
  const width = await evaluate("document.documentElement.scrollWidth");
  const part = 10000;
  if (height <= part) {
    save(name, (await send("Page.captureScreenshot", { captureBeyondViewport: true })).data);
    return;
  }
  for (let y = 0, n = 1; y < height; y += part, n++)
    save(`${name}-${n}`, (await send("Page.captureScreenshot", { captureBeyondViewport: true,
      clip: { x: 0, y, width, height: Math.min(part, height - y), scale: 1 } })).data);
}
async function shotBlock(i, name) {
  const r = await evaluate(`(() => { const b = document.querySelectorAll('.hs-block')[${i}];
    b.scrollIntoView(); const r = b.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
  const clip = { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16, scale: 1 };
  save(name, (await send("Page.captureScreenshot", { clip, captureBeyondViewport: true })).data);
}
const setCode = (i, code) => evaluate(
  `document.querySelectorAll('.hs-block')[${i}].hs.setCode(${JSON.stringify(code)})`);
const click = (i, label) => evaluate(`(async () => {
  const b = document.querySelectorAll('.hs-block')[${i}];
  const btn = [...b.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(label)});
  if (!btn) return 'NO BUTTON ' + ${JSON.stringify(label)};
  btn.click();
  for (let t = 0; t < 120; t++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!btn.disabled) return b.hs.outputText();
  }
  return 'NO OUTPUT';
})()`);

// Waits for the new page: the old one is marked, so that its editors do
// not count.
async function navigate(page) {
  await evaluate("window.oldPage = true");
  await send("Page.navigate", { url: base + page });
  for (let t = 0; t < 80; t++) {
    await sleep(100);
    if (await evaluate("!window.oldPage && document.querySelectorAll('.hs-block .CodeMirror').length > 0")) break;
  }
  await sleep(100);
}

await send("Runtime.enable");
await send("Page.enable");
let failures = 0;
// Pages carry their own tests (.expect blocks, see expect.mjs).
for (const { dir, sub } of pageDirs)
  for (const f of readdirSync(dir).filter(isPage)) {
    const sc = scenarioFromMarkdown(join(dir, f), sub ? sub + "/" : "");
    if (sc.steps.length) scenarios.push(sc);
  }

for (const sc of scenarios.filter((sc) => !process.env.ONLY || sc.page.startsWith(process.env.ONLY)).flatMap((sc) => [
  { ...sc, url: sc.page, stem: sc.page.replace(/\.html$/, "").replace("/", "-") },
  { ...sc, url: sc.page + "?layout=classic", stem: sc.page.replace(/\.html$/, "").replace("/", "-") + "-classic" }])) {
  console.log(`== ${sc.url}`);
  await setWidth(900); await setDark(false);
  await navigate(sc.url);
  await evaluate("localStorage.clear()");
  await navigate(sc.url);
  const stem = sc.stem;
  for (const [n, step] of sc.steps.entries()) {
    if (step.reload) await navigate(sc.url);
    if (step.code !== undefined) await setCode(step.block, step.code);
    let output = "";
    if (step.click) output = await click(step.block, step.click);
    if (step.js) output = String(await evaluate(step.js));
    let ok = true;
    if (step.expect) ok = step.expect.test(step.expected !== undefined ? normalise(output) : output);
    if (step.reject && step.reject.test(output)) ok = false;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${step.name}`);
    if (!ok && step.expected !== undefined)
      console.log("     expected:\n" + step.expected.split("\n").map((l) => "     | " + l).join("\n") + "\n     got:");
    if (!ok || process.env.DUMP) console.log(output.split("\n").map((l) => "     | " + l).join("\n"));
    await shotBlock(step.block, `${stem}-${String(n + 1).padStart(2, "0")}-${step.name}`);
  }
  await shotPage(`${stem}-page-light`);
  await setDark(true); await shotPage(`${stem}-page-dark`);
  await setDark(false); await setWidth(390); await sleep(300); await shotPage(`${stem}-page-phone`);
}
// Every exercise that has a solution: Check with the solution must pass.
const pages = [...new Set(pageDirs.map(({ sub }) => sub))]
  .flatMap((sub) => readdirSync(join(site, sub)).map((f) => (sub ? sub + "/" : "") + f))
  .filter((f) => f.endsWith(".html") && (!process.env.ONLY || f.startsWith(process.env.ONLY))).flatMap((f) => [f, f + "?layout=classic"]);
console.log("== solutions pass their tests");
for (const page of pages) {
  await setWidth(900); await setDark(false);
  await navigate(page);
  await evaluate("localStorage.clear()");
  await navigate(page);
  const n = await evaluate("document.querySelectorAll('.hs-block').length");
  for (let i = 0; i < n; i++) {
    const sol = await evaluate(`(document.querySelectorAll('.hs-block')[${i}].querySelector('textarea.hs-solution') || {}).value`);
    const hasCheck = await evaluate(`!!document.querySelectorAll('.hs-block')[${i}].querySelector('textarea.hs-check')`);
    if (sol === undefined || !hasCheck) continue;
    await setCode(i, sol);
    const output = await click(i, "Check");
    const ok = /^All tests passed\.$/.test(output.trim());
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${page} block ${i + 1}`);
    if (!ok || process.env.DUMP) console.log(output.split("\n").map((l) => "     | " + l).join("\n"));
    await click(i, "Reset");
  }
}

// The button presses were counted: a load, Check passes and Resets at
// least (from the solutions above), and never any code.
await sleep(500);
{
  let events = [];
  try { events = readFileSync(eventLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  const has = (a, o) => events.some((e) => e.action === a && (o === undefined || e.outcome === o));
  const ok = has("load") && has("check", "pass") && has("reset") && events.every((e) => !("code" in e))
    && events.every((e) => /^[0-9a-f]{12}$/.test(e.visit || "")) && new Set(events.map((e) => e.visit)).size > 1;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} usage counts (${events.length} events)`);
}

ws.close(); chrome.kill(); server.close(); hints.kill();
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
console.log("screenshots in " + outdir);
process.exit(failures ? 1 : 0);
