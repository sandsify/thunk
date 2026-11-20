// Tests written in a page itself, next to the blocks they test.
//
// After a runnable block (.run or .exercise, with its .check and
// .solution blocks), a page can have:
//
//   ```expect                  the output that Run should give: exactly
//   >>> fromGBP 8              what the reader sees, inputs included.
//   99.08                      [...] stands for any text (within a line or
//   ```                        over several lines). Trailing spaces and
//                              blank lines at the end do not count.
//
//   ```expect {action=check}   the same, for the Check button.
//
//   ```haskell {.attempt}      code to put in the block first (a wrong
//   ...                        answer, say); the .expect blocks after it
//   ```                        apply to that code.
//
// Readers never see these blocks (widget/filter.lua and canvas.lua drop
// them). tests/visual.mjs turns them into scenario steps.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

// A fenced block: ```{.haskell .run}, or ```haskell {.run} (the language
// first, as GitHub and editors read it; pandoc takes it as a class).
const fence = /^```[ \t]*([\w-]+)?[ \t]*(?:\{([^}]*)\})?[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;

// The fenced blocks with attributes, in order: {classes, attrs, text}.
function blocks(md) {
  const out = [];
  for (const m of md.matchAll(fence)) {
    const attr = m[2] || "";
    const classes = [...(m[1] ? [m[1]] : []), ...[...attr.matchAll(/\.([\w-]+)/g)].map((x) => x[1])];
    const attrs = Object.fromEntries([...attr.matchAll(/([\w-]+)=("[^"]*"|\S+)/g)]
      .map((x) => [x[1], x[2].replace(/^"|"$/g, "")]));
    out.push({ classes, attrs, text: m[3].replace(/\n$/, "") });
  }
  return out;
}

// The expected text as a regular expression: [...] is any text, the rest
// is literal.
export function pattern(text) {
  const trimmed = text.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
  const parts = trimmed.split("[...]").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^" + parts.join("[\\s\\S]*?") + "$");
}

// Output text, normalised the same way.
export function normalise(output) {
  return output.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
}

// The scenario for a page: {page, steps}, with steps as in scenarios.mjs.
export function scenarioFromMarkdown(path, dir = "") {
  const page = dir + basename(path, ".md") + ".html";
  const steps = [];
  let block = -1, code, n = 0;
  for (const b of blocks(readFileSync(path, "utf8"))) {
    if (["run", "exercise", "tryit"].some((c) => b.classes.includes(c))) {
      block++; code = undefined; n = 0;
    } else if ((b.classes.includes("attempt") || b.classes.includes("try")) && block >= 0) {
      code = b.text;
    } else if (b.classes.includes("expect") && block >= 0) {
      const click = b.attrs.action === "check" ? "Check" : "Run";
      n++;
      steps.push({ name: `block${block + 1}-${n}${code !== undefined ? "-try" : ""}`, block,
        code, click, expected: b.text, expect: pattern(b.text) });
    }
  }
  return { page, steps };
}
