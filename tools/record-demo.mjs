// Records docs/demo.gif: the demo page in headless Chrome, with Run, a
// failing Check, a hint, and a passing Check.
//
//   GEMINI_API_KEY=... node tools/record-demo.mjs [OUT.gif]
//
// Needs Thunk on localhost:8123 (or THUNK_URL), Google Chrome, pandoc and ffmpeg. Without
// GEMINI_API_KEY the hint comes from the mock model (marked as such).

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chrome as chromePath } from "../tests/chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || join(root, "docs/demo.gif");
const work = mkdtempSync(join(tmpdir(), "thunk-demo-"));
const site = join(work, "site"), frames = join(work, "frames");
mkdirSync(frames, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hintPort = 18200 + Math.floor(Math.random() * 300);
const hints = spawn("python3", ["-I", join(root, "hints/server.py")], {
  env: { ...process.env, PORT: String(hintPort), HINT_ORIGINS: "http://127.0.0.1:*",
    HINT_PROVIDER: process.env.GEMINI_API_KEY ? "gemini" : "mock" },
  stdio: "ignore",
});
writeFileSync(join(work, "meta.yaml"), "theme: light\n");
execFileSync(join(root, "widget/build.sh"), [join(root, "demo/demo.md"), site, process.env.THUNK_URL || ""], {
  stdio: "ignore",
  env: { ...process.env, HINT_URL: `http://127.0.0.1:${hintPort}`, THUNK_METADATA: join(work, "meta.yaml") },
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

const port = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  "--headless=new", `--remote-debugging-port=${port}`, "--hide-scrollbars",
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
const js = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const W = 820, H = 640;
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/demo.html` });
await sleep(1500);
await js("localStorage.clear()");
await send("Page.reload");
await sleep(1500);

// Frames: a screenshot every 100 ms while the script acts.
// While paused (waiting for a slow model), no frames: the GIF shortens
// the wait.
let n = 0, recording = true, paused = false;
const recorder = (async () => {
  while (recording) {
    if (paused) { await sleep(50); continue; }
    const t = Date.now();
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(frames, `f${String(n++).padStart(5, "0")}.png`), Buffer.from(shot.data, "base64"));
    await sleep(Math.max(0, 100 - (Date.now() - t)));
  }
})();

const block = (i) => `document.querySelectorAll('.hs-block')[${i}]`;
const scrollTo = (i, offset = 70) => js(`window.scrollTo({ top: ${block(i)}.getBoundingClientRect().top + scrollY - ${offset}, behavior: "smooth" })`);
const scrollBy = (dy) => js(`window.scrollBy({ top: ${dy}, behavior: "smooth" })`);
// Type text at the end of a line of a block's editor (0: definitions,
// 1: GHCi panel), a character at a time.
async function type(i, editor, line, text, replace = false) {
  await js(`(() => { const cm = ${block(i)}.querySelectorAll('.CodeMirror')[${editor}].CodeMirror;
    cm.focus(); const l = ${line} < 0 ? cm.lastLine() : ${line};
    if (${replace}) cm.replaceRange("", { line: l, ch: 0 }, { line: l, ch: cm.getLine(l).length });
    cm.setCursor({ line: l, ch: cm.getLine(l).length }); })()`);
  for (const c of text) {
    await js(`(() => { const cm = ${block(i)}.querySelectorAll('.CodeMirror')[${editor}].CodeMirror;
      cm.replaceSelection(${JSON.stringify(c)}); })()`);
    await sleep(55);
  }
}
const press = (i, label) => js(`(async () => {
  const b = [...${block(i)}.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(label)});
  b.click();
  for (let t = 0; t < 300 && b.disabled; t++) await new Promise((r) => setTimeout(r, 100));
})()`);

await sleep(1200);
await scrollTo(0); await sleep(1200);
await press(0, "Run"); await sleep(1800);
await type(0, 1, -1, "\ntotal [1 .. 100]"); await sleep(500);
await press(0, "Run"); await sleep(2200);

await scrollTo(1, 40); await sleep(1500);
await type(1, 0, 1, "count x xs = length xs", true); await sleep(600);
await press(1, "Check"); await sleep(2500);
await js(`${block(1)}.querySelector('.hs-output').scrollIntoView({ block: "center", behavior: "smooth" })`); await sleep(1000);
await press(1, "Hint"); await sleep(2500);
await js(`${block(1)}.querySelector('.hs-hint-consent button').click()`);
await sleep(1500);
paused = true;
await js(`(async () => { const b = ${block(1)};
  for (let t = 0; t < 1200 && !b.querySelector('.hs-hint'); t++) await new Promise((r) => setTimeout(r, 100)); })()`);
paused = false;
await sleep(600);
await js(`${block(1)}.querySelector('.hs-hint').scrollIntoView({ block: "center", behavior: "smooth" })`); await sleep(4500);

await scrollTo(1, 40); await sleep(1000);
await type(1, 0, 1, "count x xs = length (filter (== x) xs)", true); await sleep(600);
await press(1, "Check"); await sleep(800);
await js(`${block(1)}.querySelector('.hs-output').scrollIntoView({ block: "center", behavior: "smooth" })`);
await sleep(3000);

recording = false;
await recorder;
ws.close(); chrome.kill(); server.close(); hints.kill();

// 10 frames a second; a palette made from the frames keeps colours right.
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "10", "-i", join(frames, "f%05d.png"),
  "-vf", "scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
  "-loop", "0", out]);
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${out} (${n} frames)`);
