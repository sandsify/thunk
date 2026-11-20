// Headless Chrome test of demo/demo.md: clicks Run and Check with a few
// versions of the exercise, prints the outputs and saves screenshots.
//   widget/build.sh demo/demo.md _site
//   (cd _site && python3 -m http.server 8000) &
//   node tests/demo-browser-test.mjs http://127.0.0.1:8000/demo.html OUTDIR
// Needs Google Chrome and Thunk (thunk/) on localhost:8123.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, outdir] = process.argv.slice(2);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-port=9333", "--window-size=900,1400",
  "--user-data-dir=" + mkdtempSync(join(tmpdir(), "cdp-")), "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch("http://127.0.0.1:9333/json")).json(); break; }
  catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Runtime.consoleAPICalled") console.log("[console]", msg.params.args.map((a) => a.value).join(" "));
  if (msg.method === "Runtime.exceptionThrown") console.log("[exception]", msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
const shot = async (name) => writeFileSync(join(outdir, name), Buffer.from((await send("Page.captureScreenshot", { captureBeyondViewport: true })).result.data, "base64"));

await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url }); await sleep(2000);

const click = (block, label) => evaluate(`(async () => {
  const b = document.querySelectorAll('.hs-block')[${block}];
  [...b.querySelectorAll('button')].find(x => x.textContent === '${label}').click();
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100));
    const o = b.querySelector('.hs-output');
    if (o.textContent && !/…$/.test(o.textContent)) return o.innerText;
  }
  return 'NO OUTPUT';
})()`);
const setCode = (block, code) => evaluate(`document.querySelectorAll('.hs-block')[${block}].querySelector('.CodeMirror').CodeMirror.setValue(${JSON.stringify(code)})`);

console.log("blocks:", await evaluate("document.querySelectorAll('.hs-block .CodeMirror').length"));
console.log("--- example Run\n" + await click(0, "Run"));
console.log("--- exercise Run (undefined)\n" + await click(1, "Run"));
console.log("--- exercise Check (undefined)\n" + await click(1, "Check"));
await setCode(1, "count :: Eq a => a -> [a] -> Int\ncount x xs = length (filter (/= x) xs)\n\n>>> count 'a' \"banana\"");
console.log("--- exercise Check (wrong)\n" + await click(1, "Check"));
await setCode(1, "count :: Eq a => a -> [a] -> Int\ncount x xs = length (filter (== x) xs)\n\n>>> count 'a' \"banana\"");
console.log("--- exercise Run (right)\n" + await click(1, "Run"));
console.log("--- exercise Check (right)\n" + await click(1, "Check"));
await setCode(1, "count :: Eq a => a -> [a] -> Int\ncount x xs = x ++ xs");
console.log("--- exercise Check (type error)\n" + await click(1, "Check"));
await click(0, "Run");
await setCode(1, "count :: Eq a => a -> [a] -> Int\ncount x xs = length (filter (== x) xs)\n\n>>> count 'a' \"banana\"");
await click(1, "Check");
await shot("demo.png");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await shot("demo-dark.png");
ws.close(); chrome.kill();
