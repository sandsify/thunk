// Makes the Haskell blocks produced by filter.lua interactive: an editor
// (CodeMirror 5) with Run, and for exercises also Check.
//
// Code is sent to a play-haskell server (Thunk) with the ghci mode (see
// server/patches). Page settings, from the page's <meta> tags:
//   hs-thunk     Thunk's address
//   hs-hint      the hint service's address (hints/server.py); if
//                set, exercises get a Hint button and Run errors an
//                "Explain this error" button
//   hs-hint-by   who writes the hints, for the notice (default "Google's
//                Gemini")
//   hs-events    the usage counter (hints/server.py, POST /event); if
//                set, each button press is counted there (see track)
//   hs-notebook  "true": each block also gets the definitions of the
//                blocks before it on the page
//   hs-layout    "split" (the default): definitions on top, GHCi input in
//                a green panel below, with each result under its input;
//                "classic": one editor with ">>>" lines and a transcript.
//                "?layout=classic" (or "split") in the address overrides it.
//
// Hidden setup code (textarea.hs-hidden) goes before every block after it
// (with data-next: only before the next block).

(function () {
  "use strict";

  const SEP = "\x1e\n"; // Thunk prints this after each GHCi input
  const GHC = "9.8.4";
  const meta = (name) => (document.querySelector(`meta[name="${name}"]`) || {}).content;
  const thunkUrl = () => meta("hs-thunk") || "http://localhost:8123";
  const hintUrl = () => meta("hs-hint") || "";
  const eventsUrl = () => meta("hs-events") || "";

  // Usage counts: which button was pressed on which block, and what came
  // of it, sent to the usage counter (hints/server.py, /event). No code,
  // and nothing that tells readers apart (Dave, 2026-11-12), except a
  // random number for this visit of the page: made when the page loads,
  // kept only in memory (nothing stored in the browser), gone when the page
  // closes or reloads. It tells "one reader pressed Check 50 times" from
  // "50 visits tried it". (A per-browser id, "visitor", would need consent;
  // the server accepts one but the pages do not send it.) sendBeacon with
  // a text/plain body: no preflight, and it never holds up the page.
  const visit = Array.from(crypto.getRandomValues(new Uint8Array(6)),
    (b) => b.toString(16).padStart(2, "0")).join("");
  function track(block, action, outcome) {
    const url = eventsUrl();
    if (!url || !navigator.sendBeacon) return;
    const ev = {
      page: location.pathname, block: block ? block.number : 0, kind: block ? block.kind : "",
      action, outcome: outcome || "", visit,
      edited: !!block && block.getCode() !== block.original,
    };
    try {
      navigator.sendBeacon(url.replace(/\/$/, "") + "/event",
        new Blob([JSON.stringify(ev)], { type: "text/plain" }));
    } catch (e) { /* counting is never worth an error */ }
  }
  const notebook = () => meta("hs-notebook") === "true";
  const split = () =>
    (new URLSearchParams(location.search).get("layout") || meta("hs-layout") || "split") === "split";

  const blocks = []; // {cm, kind, number} in page order

  // Split code into the module (GHCi input lines blanked, so that the line
  // numbers stay the same) and the GHCi inputs. Same rules as Thunk:
  // ">>>" starts an input, "..." lines continue it, and ">>> :{" ... ">>> :}"
  // is one input (marked explicit).
  function scan(code) {
    const lines = code.split("\n"), isInput = [], inputs = [];
    let current = null, inBlock = false;
    for (const line of lines) {
      if (/^>>>/.test(line)) {
        const text = line.replace(/^>>> ?/, "");
        isInput.push(true);
        if (inBlock) {
          if (text === ":}") { inBlock = false; current = null; }
          else current.push(text);
          continue;
        }
        if (text === ":{") { inBlock = true; current = []; current.explicit = true; inputs.push(current); }
        else { current = [text]; inputs.push(current); }
      } else if (current && !inBlock && /^\.\.\./.test(line)) {
        current.push(line.replace(/^\.\.\. ?/, ""));
        isInput.push(true);
      } else if (current && !inBlock && /^<<</.test(line)) {
        // A line for the program to read (getLine) while it runs this input.
        (current.stdin = current.stdin || []).push(line.replace(/^<<< ?/, ""));
        isInput.push(true);
      } else {
        if (!inBlock) current = null;
        isInput.push(false);
      }
    }
    return { lines, isInput, inputs };
  }

  function parse(code) {
    const { lines, isInput, inputs } = scan(code);
    return { module: lines.map((l, i) => (isInput[i] ? "" : l)).join("\n"), inputs };
  }

  // The split layout's GHCi panel: an input starts at a line that is not
  // indented, indented lines continue it, and ":{" ... ":}" is one input.
  // Returns the inputs with their first and last line in the panel.
  function parseRepl(text) {
    const inputs = [];
    let current = null, inBlock = false;
    text.split("\n").forEach((line, i) => {
      if (inBlock) {
        if (line.trim() === ":}") { inBlock = false; current.end = i; current = null; }
        else current.lines.push(line);
        return;
      }
      if (line.trim() === "") return;
      if (/^<<</.test(line) && current) {
        (current.stdin = current.stdin || []).push(line.replace(/^<<< ?/, ""));
        current.end = i;
        return;
      }
      if (line.trim() === ":{") {
        current = { lines: [], explicit: true, start: i, end: i };
        inputs.push(current);
        inBlock = true;
      } else if (/^\s/.test(line) && current) {
        current.lines.push(line); current.end = i;
      } else {
        current = { lines: [line], start: i, end: i };
        inputs.push(current);
      }
    });
    if (inBlock) current.end = text.split("\n").length - 1;
    return inputs;
  }

  // Code in the ">>>" form <-> the split layout's two panels. The
  // definitions come first, so their line numbers are the same in both.
  function splitCode(code) {
    const { lines, isInput, inputs } = scan(code);
    const defs = lines.filter((l, i) => !isInput[i]).join("\n")
      .replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s+$/, "");
    const repl = inputs.map((inp) => {
      const plain = !/^\s/.test(inp[0] || "") && inp.slice(1).every((l) => l === "" || /^\s/.test(l));
      const text = plain && inp.length ? inp.join("\n") : [":{", ...inp, ":}"].join("\n");
      return [text, ...(inp.stdin || []).map((l) => "<<< " + l)].join("\n");
    }).join("\n");
    return { defs, repl };
  }
  function joinCode(defs, repl) {
    const prompts = parseRepl(repl).map((inp) => (inp.explicit
      ? [">>> :{", ...inp.lines.map((l) => ">>> " + l), ">>> :}"].join("\n")
      : inp.lines.map((l, j) => (j ? "... " : ">>> ") + l).join("\n"))
      + (inp.stdin || []).map((l) => "\n<<< " + l).join(""));
    return defs.replace(/\s+$/, "") + (defs.trim() && prompts.length ? "\n\n" : "") + prompts.join("\n");
  }

  const isImport = (line) => /^import\s/.test(line);
  const isPragma = (line) => /^\{-#\s*(LANGUAGE|OPTIONS_GHC|OPTIONS)\b/.test(line);
  const isHeader = (line) => /^module\s.*\bwhere\b/.test(line);

  // Build one program from segments {name, text}. File-header pragmas,
  // then the module header (only Main.hs's), then the imports of all
  // segments go first, blanked where they were; each segment starts with a
  // LINE pragma, so that GHC reports positions as "name:line:col".
  function program(segments) {
    const pragmas = [], headers = [], imports = [];
    const bodies = segments.map(({ name, text }) => {
      const lines = text.split("\n").map((l) => {
        if (isPragma(l)) { pragmas.push(l); return ""; }
        if (isHeader(l)) { if (name === "Main.hs") headers.push(l); return ""; }
        if (isImport(l)) { imports.push(l); return ""; }
        return l;
      });
      return `{-# LINE 1 "${name}" #-}\n` + lines.join("\n");
    });
    return [...pragmas, ...headers, ...imports].join("\n") + "\n" + bodies.join("\n");
  }

  // GHC quotes the physical source line under an error ("12 | ..."), which
  // after the LINE pragmas is the wrong one; quote the right source instead.
  // For a segment that is not a real file ("block 2") GHC quotes nothing,
  // so add the quote, with ^^^ under the reported columns.
  function fixExcerpts(msg, sources) {
    const chunks = msg.split(/\n(?=\S.*?:\d+:\d+(?:-\d+)?: )/);
    return chunks.map((chunk) => {
      const head = /^(.+?):(\d+):(\d+)(?:-(\d+))?: /.exec(chunk);
      const lines = head && sources[head[1]] !== undefined ? sources[head[1]].split("\n") : null;
      if (!lines) return chunk;
      if (/^\s*\d+ \| /m.test(chunk))
        return chunk.replace(/^(\s*)(\d+) \| .*$/gm, (m, sp, n) =>
          lines[n - 1] === undefined ? m : sp + n + " | " + lines[n - 1]);
      const n = +head[2], from = +head[3], to = head[4] ? +head[4] : from;
      if (lines[n - 1] === undefined) return chunk;
      const pad = " ".repeat(String(n).length);
      return chunk.replace(/\n*$/, "") + `\n${pad} |\n${n} | ${lines[n - 1]}\n${pad} | ` +
        " ".repeat(from - 1) + "^".repeat(Math.max(1, to - from + 1));
    }).join("\n");
  }

  // The hidden setup code before this block: "setup", or "setup 1", ...
  function hidden(block) {
    const all = [...document.querySelectorAll("textarea.hs-hidden")];
    const firstBlockAfter = (t) => [...document.querySelectorAll(".hs-block")]
      .find((d) => t.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING);
    return all.map((t, i) => ({ t, name: all.length > 1 ? "setup " + (i + 1) : "setup" }))
      .filter(({ t }) => t.compareDocumentPosition(block.div) & Node.DOCUMENT_POSITION_FOLLOWING)
      // data-next: only for the first block after it
      .filter(({ t }) => t.dataset.next !== "1" || firstBlockAfter(t) === block.div)
      // a standalone block gets only its own (.next) hidden code
      .filter(({ t }) => block.div.dataset.standalone !== "1" || t.dataset.next === "1")
      .map(({ t, name }) => ({ name, text: parse(t.value).module }));
  }

  // The hidden code a reader may look at: as hidden(), without .secret.
  function openHidden(block) {
    const all = [...document.querySelectorAll("textarea.hs-hidden")];
    const firstBlockAfter = (t) => [...document.querySelectorAll(".hs-block")]
      .find((d) => t.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING);
    return all
      .filter((t) => t.compareDocumentPosition(block.div) & Node.DOCUMENT_POSITION_FOLLOWING)
      .filter((t) => t.dataset.next !== "1" || firstBlockAfter(t) === block.div)
      .filter((t) => block.div.dataset.standalone !== "1" || t.dataset.next === "1")
      .filter((t) => t.dataset.secret !== "1")
      .map((t) => t.value.trim());
  }

  // The names a piece of code defines, for the "Hidden code" line:
  // imports, types, classes, instances, and functions with a signature.
  function definedNames(code) {
    const names = [];
    for (const l of code.split("\n")) {
      let m;
      if ((m = l.match(/^import\s+(?:qualified\s+)?([\w.]+)/))) names.push("import " + m[1]);
      else if ((m = l.match(/^(data|newtype|type|class)\s+([A-Z]\w*)/))) names.push(m[1] + " " + m[2]);
      else if ((m = l.match(/^instance\s+(.*?)\s+where\b/))) names.push("instance " + m[1]);
      else if ((m = l.match(/^([a-z_][\w']*(?:\s*,\s*[a-z_][\w']*)*)\s*::/))) names.push(...m[1].split(/\s*,\s*/));
    }
    return [...new Set(names)];
  }

  // A folded "Hidden code" line above a block, opening the hidden code
  // (read-only) that runs with it.
  function hiddenCodeLine(block) {
    const parts = openHidden(block);
    if (!parts.length) return;
    const code = parts.join("\n\n");
    const box = el("details", "hs-hidden-code");
    const summary = el("summary");
    summary.append(el("span", "hs-hidden-title", "Hidden code"),
                   el("span", "hs-hidden-names", definedNames(code).join(", ")));
    box.append(summary);
    box.addEventListener("toggle", () => {
      if (!box.open || box.dataset.shown) return;
      box.dataset.shown = "1";
      CodeMirror(box, { value: code, mode: "haskell", readOnly: true, lineNumbers: false,
                        viewportMargin: Infinity, lineWrapping: true });
    });
    block.div.prepend(box);
  }

  // The segments of the blocks before this one (notebook pages only).
  function earlier(block) {
    if (!notebook()) return [];
    return blocks.slice(0, blocks.indexOf(block)).map((b) => ({
      name: "block " + b.number,
      text: parse(b.getCode()).module,
    }));
  }

  // When Thunk is busy (503) or rate-limits us (429), try again a few
  // times with growing pauses; onRetry is called before each pause.
  async function submit(code, onRetry) {
    const pauses = [1000, 2000, 3000, 5000, 8000];
    for (let attempt = 0; ; attempt++) {
      // A job takes at most a few seconds once it starts; without an
      // answer after 60 s Thunk is unreachable (for example, a public
      // page may not reach Thunk on localhost).
      let res;
      try {
        res = await fetch(thunkUrl() + "/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, version: GHC, opt: "O0", output: "ghci" }),
          signal: AbortSignal.timeout(60000),
        });
      } catch (e) {
        return { err: "Could not reach the Haskell server (" + thunkUrl() + "). Please try again later." };
      }
      if ((res.status === 503 || res.status === 429) && attempt < pauses.length) {
        onRetry();
        await new Promise((r) => setTimeout(r, pauses[attempt] * (0.75 + Math.random() / 2)));
        continue;
      }
      if (res.status === 503 || res.status === 429)
        return { err: "The Haskell server is busy. Please try again in a minute." };
      if (!res.ok) return { err: "The Haskell server answered " + res.status + "." };
      return res.json();
    }
  }

  // Send the program; returns the outputs per input (and GHC's warnings,
  // if any, as outputs.warnings), or null after showing an error.
  async function execute(block, segments, busy) {
    // Compile errors and warnings are about the definitions: in the split
    // layout they go between the two panels (block.msg), otherwise in out.
    const out = block.out, msg = block.msg;
    if (msg !== out) msg.replaceChildren();
    const sources = Object.fromEntries(segments.map((s) => [s.name, s.text]));
    block.div.classList.remove("hs-stale");
    block.lastError = null;
    out.replaceChildren(el("div", "hs-status", busy));
    let r;
    const retrying = () => out.replaceChildren(el("div", "hs-status", "Many people are running code right now; trying again…"));
    try { r = await submit(program(segments), retrying); }
    catch (e) { showError(out, "Could not reach the Haskell server at " + thunkUrl() + "."); return null; }
    if (r.err === "timeout") { showError(out, "Stopped: took more than 5 seconds."); return null; }
    if (r.err) { showError(out, r.err); return null; }
    const ghcout = fixExcerpts((r.ghcout || "").trim(), sources);
    if (/^\S.*?:\d+:\d+(-\d+)?: error/m.test(ghcout) || (r.ec && ghcout)) {
      if (msg !== out) out.replaceChildren();
      showError(msg, ghcout);
      block.lastError = ghcout;
      return null;
    }
    const parts = (r.sout || "").split(SEP);
    if (parts[parts.length - 1] === "") parts.pop();
    const outputs = parts.map((p) => p.replace(/^\n+/, "").replace(/\n+$/, ""));
    outputs.warnings = ghcout;
    return outputs;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function showError(out, text) {
    out.replaceChildren(el("pre", "hs-error", text));
  }

  const isErrorOutput = (o) => /^<interactive>:\d+:\d+: error|^\*\*\* (Exception|Stopped)/m.test(o);

  // An input as shown in a transcript, with the lines it gives the program.
  const showInput = (inp) => [...inp.map((l, j) => (j ? "... " : ">>> ") + l),
    ...(inp.stdin || []).map((l) => "<<< " + l)].join("\n");
  const transcript = (inputs, outputs) => inputs.map((inp, i) =>
    showInput(inp) + (outputs[i] ? "\n" + outputs[i] : "")).join("\n");

  // Run: the code with its own GHCi inputs; show each input with its output.
  async function run(block) {
    const out = block.out, code = block.getCode();
    block.lastAction = "run";
    block.transcript = "";
    clearInline(block);
    // In the split layout, the results go under the lines that are there now.
    const repl = block.repl && parseRepl(block.repl.getValue())
      .map((inp) => ({ lines: Object.assign([...inp.lines], { stdin: inp.stdin }),
        handle: block.repl.getLineHandle(inp.end) }));
    const inputs = repl ? repl.map((r) => r.lines) : parse(code).inputs;
    const context = [...hidden(block), ...earlier(block)];
    const outputs = await execute(block, [...context, { name: "Main.hs", text: code }], "Running…");
    const explain = (output) => offerExplain(block, { code, context, output });
    if (!outputs) {
      if (block.lastError) explain("GHC's messages:\n" + block.lastError);
      return;
    }
    if (outputs.some(isErrorOutput)) {
      // after the results are shown below
      setTimeout(() => explain((outputs.warnings ? "GHC's warnings:\n" + outputs.warnings + "\n\n" : "")
        + "GHCi inputs and their outputs:\n" + transcript(inputs, outputs)));
    }
    const warnings = outputs.warnings ? [el("pre", "hs-warning", outputs.warnings)] : [];
    if (inputs.length === 0) {
      if (repl) block.msg.replaceChildren(...warnings);
      out.replaceChildren(...(repl ? [] : warnings), el("div", "hs-status", repl
        ? "Compiled without errors. Type an expression in the green box to evaluate it."
        : "Compiled without errors. Add a line like  >>> expression  to evaluate something."));
      return;
    }
    if (repl) {
      block.msg.replaceChildren(...warnings);
      out.replaceChildren();
      block.transcript = transcript(inputs, outputs);
      repl.forEach((r, i) => {
        const o = outputs[i] || "";
        if (!o) return;
        const node = el("pre", "hs-inline " + (isErrorOutput(o) ? "hs-error" : "hs-result"), o);
        block.widgets.push(block.repl.addLineWidget(r.handle, node, { noHScroll: true }));
      });
      return;
    }
    const pre = el("pre", "hs-transcript");
    inputs.forEach((inp, i) => {
      pre.append(el("span", "hs-input", showInput(inp) + "\n"));
      const o = outputs[i] || "";
      if (o) pre.append(el("span", isErrorOutput(o) ? "hs-error" : "hs-result", o + "\n"));
    });
    out.replaceChildren(...warnings, pre);
  }

  function clearInline(block) {
    (block.widgets || []).forEach((w) => w.clear());
    block.widgets = [];
  }

  // doctest's "prop>" in tests: "prop> \xs -> ..." runs quickCheck on the
  // property, and a failure is shown under the property's own text.
  // Returns the tests with "prop>" lines as ">>> quickCheck (...)", and for
  // each input the "prop>" line it came from (or null).
  function props(tests) {
    const lines = tests.split("\n"), prop = lines.map((l) => /^prop> ?(.*)$/.exec(l));
    if (!prop.some(Boolean)) return { text: tests, labels: [] };
    const text = lines.map((l, i) => (prop[i] ? ">>> quickCheck (" + prop[i][1] + ")" : l)).join("\n")
      // imports are moved to the top anyway; at the end, no line moves
      + (/^import\s+Test\.QuickCheck\b/m.test(tests) ? "" : "\nimport Test.QuickCheck");
    // The same lines with a mark, to find which inputs came from "prop>".
    const marked = lines.map((l, i) => (prop[i] ? ">>> \u0000" + prop[i][1] : l)).join("\n");
    const labels = scan(marked).inputs.map((inp) =>
      inp[0] && inp[0][0] === "\u0000" ? "prop> " + inp[0].slice(1) : null);
    return { text, labels };
  }

  // Check: the code without its GHCi inputs, followed by the hidden tests.
  async function check(block, testsIn, action = "check") {
    const { text: tests, labels } = props(testsIn);
    const out = block.out, own = parse(block.getCode()).module;
    block.lastAction = "check";
    const context = [...hidden(block), ...earlier(block)];
    const outputs = await execute(block,
      [...context, { name: "Main.hs", text: own }, { name: "tests", text: tests }],
      "Checking…");
    // What happened, for the Hint button: null if the code could not be run.
    const info = { code: own, context, tests };
    if (!outputs) {
      track(block, action, block.lastError ? "error" : "none");
      return block.lastError ? { ...info, passed: false, output: "GHC's messages:\n" + block.lastError } : null;
    }
    const failures = outputs.map((o, i) => (/^\+\+\+ OK/.test(o) ? null : labels[i] ? labels[i] + "\n" + o : o))
      .filter((f) => f !== null);
    const box = el("div", failures.length ? "hs-fail" : "hs-pass");
    box.append(el("strong", null, failures.length ? "Not yet: a test failed." : "All tests passed."));
    if (failures.length) box.append(el("pre", null, failures.join("\n\n")));
    out.replaceChildren(box);
    track(block, action, failures.length ? "fail" : "pass");
    if (!failures.length) {
      rememberPass(block);
      if (block.onPass) block.onPass();
    }
    const warnings = outputs.warnings ? "GHC's warnings:\n" + outputs.warnings + "\n\n" : "";
    return { ...info, passed: !failures.length,
      output: warnings + (failures.length ? "The tests that failed:\n" + failures.join("\n\n") : "All tests passed.") };
  }

  // The text of the exercise: the page's text from the heading before
  // the block down to the block.
  function exerciseText(block) {
    // A block page for an iframe (canvas.lua) carries the text itself.
    const given = document.querySelector("textarea.hs-context-text");
    if (given) return given.value.trim();
    const parts = [];
    for (let e = block.div.previousElementSibling; e; e = e.previousElementSibling) {
      if (!e.matches(".hs-block, textarea, script")) parts.unshift(e.textContent.trim());
      if (/^H[1-3]$/.test(e.tagName)) break;
    }
    return parts.join("\n\n");
  }

  // A small, safe subset of Markdown for hints: paragraphs, lists (- or
  // 1.), `code`, **bold** and *italics*. Everything is escaped first, so
  // the model's text cannot add other HTML.
  function markdown(text) {
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (t) => t.split(/(`[^`]+`)/).map((part) =>
      /^`[^`]+`$/.test(part) ? "<code>" + esc(part.slice(1, -1)) + "</code>"
        : esc(part).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")).join("");
    const body = el("div", "hs-hint-body");
    let html = "";
    // Within a paragraph, list items may follow a line of text ("Consider:"),
    // and a line that is not an item continues the item before it.
    const kind = (l) => /^[-*+] /.test(l) ? "ul" : /^\d+[.)] /.test(l) ? "ol" : null;
    for (const para of text.trim().split(/\n\s*\n/)) {
      let words = [], list = null;
      const flushText = () => { if (words.length) html += "<p>" + inline(words.join(" ")) + "</p>"; words = []; };
      const flushList = () => {
        if (list) html += `<${list.tag}>` + list.items.map((i) => "<li>" + inline(i.join(" ")) + "</li>").join("") + `</${list.tag}>`;
        list = null;
      };
      for (const raw of para.split("\n")) {
        const l = raw.trim();
        if (!l) continue;
        const k = kind(l);
        if (k) {
          flushText();
          if (list && list.tag !== k) flushList();
          if (!list) list = { tag: k, items: [] };
          list.items.push([l.replace(/^([-*+]|\d+[.)]) /, "")]);
        } else if (list && /^\s/.test(raw)) {
          list.items[list.items.length - 1].push(l); // an indented continuation of the item
        } else {
          flushList();
          words.push(l);
        }
      }
      flushText(); flushList();
    }
    body.innerHTML = html;
    return body;
  }

  // AI hints (hints/server.py). Nothing is sent until the reader asks,
  // and the first time they are told what is sent where.
  //   fix      Hint after a failed Check; "More help" gives up to three levels
  //   style    Hint after a passing Check: feedback on style
  //   explain  "Explain this error" after Run gives an error
  const hintBy = () => meta("hs-hint-by") || "Google's Gemini";
  const consentKey = "fp-notes:hint-consent";

  function consent(container) {
    try { if (localStorage.getItem(consentKey) === "yes") return Promise.resolve(true); } catch (e) { /* ask */ }
    return new Promise((resolve) => {
      const box = el("div", "hs-hint-consent");
      box.append(el("p", null, "Hints are written by an AI model, " + hintBy() + ". Your code and its output " +
        "are sent there, and may be used to improve the model. Do not put personal data in your code."));
      const send = el("button", null, "Send"), cancel = el("button", "hs-secondary", "Cancel");
      send.type = cancel.type = "button";
      send.onclick = () => {
        try { localStorage.setItem(consentKey, "yes"); } catch (e) { /* ask again next time */ }
        box.remove(); resolve(true);
      };
      cancel.onclick = () => { box.remove(); resolve(false); };
      box.append(send, cancel);
      container.append(box);
    });
  }

  async function requestHint(block, info, mode, level, previous) {
    try {
      const resp = await fetch(hintUrl().replace(/\/$/, "") + "/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: location.pathname + "#" + block.number,
          mode, level, previous: previous.join("\n\n---\n\n"),
          exercise: exerciseText(block),
          code: info.code,
          context: info.context.map((s) => "-- " + s.name + "\n" + s.text).join("\n\n"),
          tests: info.tests || "",
          output: info.output,
          solution: mode === "explain" ? "" : block.solution || "",
        }),
      });
      return await resp.json();
    } catch (e) {
      return { hint: null, why: "Could not reach the hint service." };
    }
  }

  const hintLabels = { fix: "AI hint", style: "AI feedback on style", explain: "AI explanation" };

  // Asks for a hint and shows it in container; for "fix", a "More help"
  // button asks for the next level, with the earlier hints as context.
  async function showHints(block, container, info, mode) {
    if (!(await consent(container))) return;
    const previous = [];
    for (let level = 1; ; level++) {
      const status = el("div", "hs-status", "Asking for " + (mode === "style" ? "feedback" : "a hint") + "…");
      container.append(status);
      track(block, "ai-" + mode, String(level));
      const r = await requestHint(block, info, mode, level, previous);
      status.remove();
      const box = el("div", "hs-hint");
      box.append(el("div", "hs-label", r.hint
        ? hintLabels[mode] + (level > 1 ? " " + level : "") + " (it may be wrong)" : "No hint"));
      if (r.hint) box.append(markdown(r.hint));
      else box.append(el("p", null, r.why || "No hint this time."));
      container.append(box);
      if (!r.hint || mode !== "fix" || level >= 3) return;
      previous.push(r.hint);
      const more = el("button", "hs-secondary hs-more", "More help");
      more.type = "button";
      box.append(more);
      const clicked = await new Promise((resolve) => { more.onclick = () => resolve(true); });
      more.remove();
      if (!clicked || !container.isConnected) return;
    }
  }

  // After Run gives an error: a button that asks for an explanation.
  function offerExplain(block, info) {
    if (!hintUrl()) return;
    const btn = el("button", "hs-secondary hs-explain", "Explain this error");
    btn.type = "button";
    const wrap = el("div", "hs-hint-offer");
    wrap.append(btn);
    block.out.append(wrap);
    btn.onclick = () => { btn.remove(); showHints(block, wrap, info, "explain"); };
  }

  // Whether the reader's code has passed this exercise's tests (which
  // makes the solution available), kept in the browser.
  const passKey = (block) => "fp-notes:passed:" + location.pathname + ":" + block.number;
  function passedBefore(block) {
    try { return localStorage.getItem(passKey(block)) === "yes"; } catch (e) { return false; }
  }
  function rememberPass(block) {
    try { localStorage.setItem(passKey(block), "yes"); } catch (e) { /* shown until reload */ }
  }

  // The reader's edits are kept in the browser, per page and block.
  const storageKey = (block) => "fp-notes:" + location.pathname + ":" + block.number;
  function load(block) {
    try { return localStorage.getItem(storageKey(block)); } catch (e) { return null; }
  }
  function store(block, text) {
    try {
      if (text === null) localStorage.removeItem(storageKey(block));
      else localStorage.setItem(storageKey(block), text);
    } catch (e) { /* no storage: edits are just not kept */ }
  }

  // After an edit, outputs that may no longer match the code are dimmed:
  // the block's own, and on notebook pages those of the blocks below.
  function markStale(block) {
    const from = blocks.indexOf(block);
    blocks.forEach((b, j) => {
      if (j === from || (notebook() && j > from)) b.div.classList.add("hs-stale");
    });
  }

  function setup(div, i) {
    const kind = div.dataset.kind;
    const area = div.querySelector("textarea.hs-code");
    const tests = div.querySelector("textarea.hs-check");
    const solution = div.querySelector("textarea.hs-solution");
    const block = { kind, number: i + 1, div, widgets: [], solution: solution ? solution.value : "" };
    const saved = load(block);
    const wrap = matchMedia("(max-width: 600px)").matches;
    const options = (more) => ({
      mode: "haskell",
      lineNumbers: true,
      lineWrapping: wrap,
      indentUnit: 2,
      viewportMargin: Infinity,
      extraKeys: {
        Tab: (cm) => cm.replaceSelection("  "),
        "Ctrl-Enter": () => runBtn.click(),
        "Cmd-Enter": () => runBtn.click(),
      },
      ...more,
    });
    let original = area.value;
    if (split()) {
      // Definitions on top (hidden while there are none), GHCi input below.
      const start = splitCode(saved !== null ? saved : area.value);
      const first = splitCode(area.value);
      original = joinCode(first.defs, first.repl);
      area.value = start.defs;
      block.cm = CodeMirror.fromTextArea(area, options());
      const panel = el("div", "hs-repl");
      block.msg = el("div", "hs-output hs-msg");
      div.append(block.msg, panel);
      block.repl = CodeMirror(panel, options({
        value: start.repl, lineNumbers: false, gutters: ["hs-prompt"],
        placeholder: "Type an expression, e.g.  1 + 2",
      }));
      const prompts = () => {
        block.repl.clearGutter("hs-prompt");
        parseRepl(block.repl.getValue()).forEach((inp) =>
          block.repl.setGutterMarker(inp.start, "hs-prompt", el("span", "hs-prompt-mark", ">")));
      };
      const showDefs = () => {
        const wrapper = block.cm.getWrapperElement(), show = !!(first.defs || block.cm.getValue().trim());
        if (wrapper.hidden === show) { wrapper.hidden = !show; if (show) block.cm.refresh(); }
      };
      block.getCode = () => joinCode(block.cm.getValue(), block.repl.getValue());
      block.setCode = (code) => {
        const p = splitCode(code);
        block.cm.setValue(p.defs); block.repl.setValue(p.repl);
        showDefs();
      };
      block.repl.on("change", prompts);
      prompts(); showDefs();
    } else {
      if (saved !== null) area.value = saved;
      block.cm = CodeMirror.fromTextArea(area, options());
      block.getCode = () => block.cm.getValue();
      block.setCode = (code) => block.cm.setValue(code);
    }
    block.original = original;
    blocks.push(block);
    hiddenCodeLine(block);
    if (notebook()) div.prepend(el("div", "hs-label", "block " + block.number));
    const bar = el("div", "hs-bar");
    const out = el("div", "hs-output");
    out.setAttribute("aria-live", "polite");
    block.out = out;
    if (!block.msg) block.msg = out;
    const note = el("div", "hs-note", "Your edited version. Reset brings back the original.");
    note.hidden = saved === null || saved === original;
    const changed = () => {
      markStale(block);
      const text = block.getCode();
      note.hidden = text === original;
      store(block, text === original ? null : text);
    };
    block.cm.on("change", changed);
    if (block.repl) block.repl.on("change", changed);
    const button = (label, fn) => {
      const b = el("button", null, label);
      b.type = "button";
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await fn(); } finally { b.disabled = false; }
      });
      bar.append(b);
      return b;
    };
    const runBtn = button("Run", async () => {
      await run(block);
      track(block, "run", block.lastError ? "error" : "ok");
    });
    runBtn.title = "Run (Ctrl-Enter)";
    if (kind === "exercise" && tests) button("Check", () => check(block, tests.value));
    if (kind === "exercise" && tests && hintUrl()) {
      const hintBtn = button("Hint", async () => {
        const info = await check(block, tests.value, "hint");
        if (!info) return;
        const area = el("div", "hs-hint-area");
        out.append(area);
        showHints(block, area, info, info.passed ? "style" : "fix"); // not awaited: More help may wait long
      });
      hintBtn.title = "Check, then ask an AI model for a hint (or, if the tests pass, feedback on style)";
    }
    const spacer = el("span", "hs-spacer");
    bar.append(spacer);
    let shown = null;
    if (solution) {
      // An open block ("try it yourself" in the lecture text) offers its
      // definition from the start; an exercise only once the tests pass.
      const open = div.dataset.open === "1";
      const showLabel = open ? "Show definition" : "Show solution";
      const solBtn = button(showLabel, async () => {
        if (shown) { shown.remove(); shown = null; solBtn.textContent = showLabel; return; }
        track(block, open ? "show-definition" : "show-solution");
        shown = el("div", "hs-solution");
        shown.append(el("div", "hs-label", open ? "The definition" : "A solution"));
        div.insertBefore(shown, out);
        CodeMirror(shown, { value: solution.value, mode: "haskell", readOnly: true,
          lineNumbers: true, viewportMargin: Infinity, lineWrapping: wrap });
        solBtn.textContent = open ? "Hide definition" : "Hide solution";
      });
      solBtn.classList.add("hs-secondary");
      // Offered only once the reader's own code passes the tests (on
      // exercises with tests): remembered in the browser, per block.
      if (tests && !open) {
        solBtn.hidden = !passedBefore(block);
        block.onPass = () => { solBtn.hidden = false; };
      }
    }
    button("Reset", async () => {
      track(block, "reset");
      block.setCode(original);
      store(block, null);
      out.replaceChildren();
      block.msg.replaceChildren();
      clearInline(block);
    }).classList.add("hs-secondary");
    div.append(bar, note, out);
    // For tests (tests/visual.mjs): the code in the ">>>" form, and the
    // results as text, with the inputs in the split layout.
    div.hs = {
      getCode: () => block.getCode(),
      setCode: (code) => block.setCode(code),
      outputText: () => block.repl && block.lastAction === "run"
        ? [block.msg.innerText.trim(), out.innerText.trim(), block.transcript].filter(Boolean).join("\n")
        : [block.msg === out ? "" : block.msg.innerText.trim(), out.innerText].filter(Boolean).join("\n"),
    };
  }

  // A block page in an iframe tells the page around it its height, with
  // the message Canvas uses to resize the iframes of LTI tools.
  function reportHeight() {
    if (!document.documentElement.classList.contains("hs-embed") || window.parent === window) return;
    let last = 0;
    const send = () => {
      const height = Math.ceil(document.body.getBoundingClientRect().height) + 2;
      if (height === last) return;
      last = height;
      window.parent.postMessage(JSON.stringify({ subject: "lti.frameResize", height }), "*");
    };
    new ResizeObserver(send).observe(document.body);
    send();
  }

  // Pages with `qr: true` (class meetings): a QR code of the page's own
  // address, so that students can open it from the screen. A click shows
  // it large, for projecting; another click (or Escape) closes it.
  function setupQr() {
    const box = document.getElementById("hs-qr");
    if (!box || typeof qrcode !== "function") return;
    const url = location.origin + location.pathname;
    const svg = (size) => {
      const q = qrcode(0, "M");
      q.addData(url);
      q.make();
      const s = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: "QR code: " + url });
      const holder = el("div", size);
      holder.innerHTML = s;
      return holder;
    };
    const small = svg("hs-qr-code");
    const link = el("a", "hs-qr-url", url.replace(/^https?:\/\//, ""));
    link.href = url;
    const btn = el("button", "hs-secondary", "Show large");
    btn.type = "button";
    const side = el("div", "hs-qr-side");
    side.append(el("div", "hs-qr-label", "Open this page on your own device:"), link, btn);
    box.append(small, side);
    box.hidden = false;
    const open = () => {
      const overlay = el("div", "hs-qr-overlay");
      overlay.append(svg("hs-qr-big"), el("div", "hs-qr-big-url", url.replace(/^https?:\/\//, "")));
      const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
      const onKey = (e) => { if (e.key === "Escape") close(); };
      overlay.addEventListener("click", close);
      document.addEventListener("keydown", onKey);
      document.body.append(overlay);
    };
    btn.addEventListener("click", open);
    small.addEventListener("click", open);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".hs-block").forEach(setup);
    track(null, "load");
    setupQr();
    reportHeight();
  });
})();
