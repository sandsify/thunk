// Experimental: a stand-in for Thunk's server that runs the code with
// MicroHs (mhs) instead of GHC, to measure what a serverless MicroHs
// backend (mhs compiled to WebAssembly, in the browser) would give.
// It speaks the protocol of docs/PROTOCOL.md, as the GHCi mode of the real
// server (server/patches/ghci-mode.patch) does, so pages and tests can use it
// as their THUNK_URL.
//
//   PATH=~/.mcabal/bin:$PATH node tools/mhs-server.mjs [PORT]   (default 8125)
//
// What it does, as the GHC version does:
//   - splits the code into Main.hs and GHCi input (">>>", "...", "<<<"),
//   - type checks Main.hs (errors go to ghcout, with ec 1),
//   - runs the input in mhs's interactive mode, with a \x1e line after
//     each input, and stops after 3.5 seconds.
// Differences it has to paper over (each is a finding):
//   - a file without a module header must define main in mhs, so the
//     server adds "module Main where" and moves error line numbers back;
//   - the module's imports are not in scope at the mhs prompt, so the
//     server repeats them there;
//   - ":t e" prints only the type, with an explicit forall; the server
//     prints "e :: type" as GHCi does.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.argv[2] || 8125);
const RS = "\x1e";
const ENGINE = "mhs-0.17.3"; // docs/PROTOCOL.md: the answer says which engine answered

function split(code) {
  const main = [], script = []; // script: [{lines, stdin}]
  let buf = [], stdin = [], inblock = false;
  const flush = () => {
    if (buf.length) script.push({ lines: buf, stdin });
    buf = []; stdin = [];
  };
  for (const line of code.split("\n")) {
    if (/^>>>/.test(line)) {
      const s = line.replace(/^>>> ?/, ""); main.push("");
      if (inblock) { if (s === ":}") { inblock = false; flush(); } else buf.push(s); continue; }
      flush();
      if (s === ":{") inblock = true; else buf.push(s);
      continue;
    }
    if (buf.length && /^\.\.\./.test(line)) { buf.push(line.replace(/^\.\.\. ?/, "")); main.push(""); continue; }
    if (buf.length && !inblock && /^<<</.test(line)) { stdin.push(line.replace(/^<<< ?/, "")); main.push(""); continue; }
    if (!inblock) flush();
    main.push(line);
  }
  flush();
  return { main: main.join("\n"), script };
}

function run(args, input, dir, ms) {
  return new Promise((resolve) => {
    const p = spawn("mhs", args, { cwd: dir, detached: true });
    let out = "", killed = false;
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => { killed = true; try { process.kill(-p.pid, "SIGKILL"); } catch {} }, ms);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out, killed }); });
    p.stdin.end(input);
  });
}

async function submit(code) {
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "mhs-"));
  try {
    let { main, script } = split(code);
    let offset = 0;
    if (!/^module\s/m.test(main)) { main = "module Main where\n" + main; offset = 1; }
    writeFileSync(join(dir, "Main.hs"), main + "\n");
    const fixLines = (s) => s
      .replace(/\.\/Main\.hs:(\d+):/g, (_, n) => `Main.hs:${n - offset}:`)
      .replace(/^(\s*)(\d+)( \|)/gm, (_, a, n, b) => `${a}${n - offset}${b}`)
      .replace(/^No code generated\n?/m, "");
    const tc = await run(["-fno-code", "Main"], "", dir, 20000);
    const tcOut = tc.out.split("\n").filter((l) => !/^Loading package/.test(l)).join("\n").trim();
    if (/error:/.test(tcOut)) return { ec: 1, ghcout: fixLines(tcOut) + "\n", sout: "", serr: "", timesecs: (Date.now() - t0) / 1000, engine: ENGINE };
    const imports = main.split("\n").filter((l) => /^import\s/.test(l));
    let input = ':set prompt=\n:set prompt-cont=\n' + imports.join("\n") + "\nSystem.IO.putStrLn \"\\RS\"\n";
    for (const { lines, stdin } of script) {
      input += (lines.length === 1 ? lines[0] : ":{\n" + lines.join("\n") + "\n:}") + "\n";
      for (const s of stdin) input += s + "\n";
      input += 'System.IO.putStrLn "\\RS"\n';
    }
    const r = await run(["--stdin", "--interactive", "Main"], input, dir, 3500);
    let out = r.out.split("\n").filter((l) => !/^Loading package/.test(l)).join("\n");
    const start = out.indexOf(RS + "\n");
    out = start < 0 ? "" : out.slice(start + 2);
    // ":t e": GHCi prints "e :: type"
    const parts = out.split(RS + "\n");
    script.forEach(({ lines }, i) => {
      const m = lines.length === 1 && /^:t(ype)?\s+(.*)$/.exec(lines[0]);
      if (m && parts[i] !== undefined)
        parts[i] = m[2] + " :: " + parts[i].replace(/^forall [^.]*\. /, "");
    });
    out = parts.join(RS + "\n").replace(/^Bye\n?/m, "");
    if (r.killed) out += "\n*** Stopped: took more than 3.5 seconds.\n";
    return { ec: 0, ghcout: "", sout: fixLines(out), serr: "", timesecs: (Date.now() - t0) / 1000, engine: ENGINE };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

createServer(async (req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.url !== "/submit" || req.method !== "POST") { res.writeHead(404, cors); return res.end(); }
  let body = "";
  for await (const c of req) body += c;
  let answer;
  try { answer = await submit(JSON.parse(body).code); }
  catch (e) { answer = { err: "backend: " + e.message }; }
  res.writeHead(200, { ...cors, "Content-Type": "application/json" });
  res.end(JSON.stringify(answer));
}).listen(port, "127.0.0.1", () => console.log(`mhs stand-in for Thunk on http://127.0.0.1:${port}`));
