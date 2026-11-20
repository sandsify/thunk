// Load test of Thunk running locally: N requests at once.
//   node tests/load.mjs N [FILE]
// Each request is a small QuickCheck run, or the code in FILE (a module
// with >>> lines, as in tests/load/*.hs). Prints the HTTP status counts
// and the latencies.
import { readFileSync } from "node:fs";
const n = +process.argv[2];
const code = process.argv[3] ? readFileSync(process.argv[3], "utf8")
  : "import Test.QuickCheck\nprop :: [Int] -> Bool\nprop xs = reverse (reverse xs) == xs\n>>> quickCheck prop\n>>> sum [1..1000]";
const t0 = Date.now();
// Each request differs (a comment), so that no cache can answer it.
const res = await Promise.all(Array.from({ length: n }, async (_, i) => {
  const s = Date.now();
  const r = await fetch("http://localhost:8123/submit", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: `-- request ${i} ${t0}\n` + code, version: "9.8.4", opt: "O0", output: "ghci" }) });
  const j = r.ok ? await r.json() : null;
  return { status: r.status, ok: !!(j && !j.err && j.ec === 0 && !/rror|Exception|Failed/.test(j.sout || "")), err: j && j.err, ms: Date.now() - s };
}));
const ms = res.map((r) => r.ms).sort((a, b) => a - b);
const by = {}; res.forEach((r) => { const k = r.status + (r.ok ? " ok" : " " + (r.err || "bad")); by[k] = (by[k] || 0) + 1; });
console.log(`n=${n} total=${Date.now() - t0}ms median=${ms[n >> 1]}ms max=${ms[n - 1]}ms`, by);
