// Test of replay mode: the demo page built with its recording and no
// server (THUNK_REPLAY, no THUNK_URL), in headless Chrome.
//
//   node tests/replay.mjs
//
// The page's own code must give the recorded results, changed code the
// note that it needs a server, and the page must send nothing to any
// server. Needs Google Chrome (or Chromium; CHROME=path) and pandoc,
// but no Thunk. Exits with 1 if a check failed.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { scenarioFromMarkdown, normalise } from "./expect.mjs";
import { chrome as chromePath } from "./chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "thunk-replay-test-")), site = join(work, "site");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = join(root, "demo/demo.md");
execFileSync(join(root, "widget/build.sh"), [page, site], { stdio: "ignore",
  env: { ...process.env, THUNK_REPLAY: join(root, "demo/demo.replay.json"), HINT_URL: "", EVENTS_URL: "" } });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer((req, res) => {
  try {
    const path = decodeURIComponent(req.url.split("?")[0]);
    const body = readFileSync(join(site, path));
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, [
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
const pending = new Map(), requests = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Network.requestWillBeSent") requests.push(msg.params.request.url);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});
const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const setCode = (i, code) => evaluate(`document.querySelectorAll('.hs-block')[${i}].hs.setCode(${JSON.stringify(code)})`);
const getCode = (i) => evaluate(`document.querySelectorAll('.hs-block')[${i}].hs.getCode()`);
const click = (i, label) => evaluate(`(async () => {
  const b = document.querySelectorAll('.hs-block')[${i}];
  const btn = [...b.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(label)});
  if (!btn) return 'NO BUTTON ' + ${JSON.stringify(label)};
  btn.click();
  for (let t = 0; t < 100; t++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!btn.disabled) return b.hs.outputText();
  }
  return 'NO OUTPUT';
})()`);
async function load() {
  await send("Page.navigate", { url: origin + "/demo.html" });
  await sleep(300);
  await evaluate("localStorage.clear()");
  await send("Page.navigate", { url: origin + "/demo.html" });
  for (let t = 0; t < 80; t++) {
    await sleep(100);
    if (await evaluate("document.querySelectorAll('.hs-block .CodeMirror').length > 0")) break;
  }
}

let failures = 0;
const ok = (name, good, output = "") => {
  if (!good) failures++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}`);
  if (!good) console.log(String(output).split("\n").map((l) => "     | " + l).join("\n"));
};

await send("Network.enable");
await send("Page.enable");
await load();
ok("no hs-thunk meta, hs-replay set", await evaluate(
  `!document.querySelector('meta[name="hs-thunk"]') && document.querySelector('meta[name="hs-replay"]').content === "demo.replay.json"`));

// The page's own tests (.attempt, .expect) pass from the recording.
for (const step of scenarioFromMarkdown(page).steps) {
  if (step.code !== undefined) await setCode(step.block, step.code);
  const out = await click(step.block, step.click);
  ok(`recorded: ${step.name}`, step.expect.test(normalise(out)), out);
}
await load();
let out = await click(0, "Run");
ok("recorded: Run as the page has it", /^>>> total \[1, 2, 3, 4\]\n10\n/m.test(out), out);
out = await click(1, "Check");
ok("recorded: Check as the page has it fails", /Not yet: a test failed\./.test(out), out);
const sol = await evaluate(`document.querySelectorAll('.hs-block')[1].querySelector('textarea.hs-solution').value`);
await setCode(1, sol);
out = await click(1, "Check");
ok("recorded: Check with the solution passes", /^All tests passed\./.test(out.trim()), out);

// Changed code: the note, and nothing sent anywhere.
await setCode(0, (await getCode(0)) + "\n>>> total [5]");
out = await click(0, "Run");
ok("changed code: needs a server", /recorded results and has no Haskell server/.test(out), out);
// (CodeMirror comes from cdnjs: a library, not a server that runs code.)
const elsewhere = requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:")
  && !u.startsWith("https://cdnjs.cloudflare.com/"));
ok("no request outside the page's site and cdnjs", elsewhere.length === 0, elsewhere.join("\n"));

ws.close(); chrome.kill(); server.close();
rmSync(work, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
