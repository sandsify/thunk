#!/usr/bin/env python3
"""Converts pages from the older names to the current format (see
docs/WRITING.md), in place:

  ```{.haskell .run}           -> ```haskell {.run}
  {.haskell .exercise .open}   -> haskell {.tryit}
  .hidden                      -> .setup
  .try                         -> .attempt
  ```{.expect}                 -> ```expect
  ```{.expect action=check}    -> ```expect {action=check}
  a ## or ### heading starting with "Exercise", down to the next heading
  of the same or a higher level (or a horizontal rule)
                               -> ::: exercise ... :::

The page must build to the same HTML before and after; check with
widget/build.sh.

  tools/convert-names.py PAGE.md [...]
"""
import re
import sys

FENCE = re.compile(r"^(```+|~~~+)\s*\{([^}]*)\}\s*$")
RENAME = {"hidden": "setup", "try": "attempt"}


def header(line):
    m = FENCE.match(line)
    if not m:
        return line
    fence, attrs = m.group(1), m.group(2).split()
    classes = [a[1:] for a in attrs if a.startswith(".")]
    others = [a for a in attrs if not a.startswith(".")]
    classes = [RENAME.get(c, c) for c in classes]
    if "exercise" in classes and "open" in classes:
        classes = [c for c in classes if c not in ("exercise", "open")]
        classes.insert(1 if classes[:1] == ["haskell"] else 0, "tryit")
    lang = None
    for first in ("haskell", "expect"):
        if first in classes:
            lang = first
            classes.remove(first)
            break
    rest = " ".join(["." + c for c in classes] + others)
    if lang:
        return fence + lang + (" {" + rest + "}" if rest else "")
    return fence + "{" + rest + "}"


def convert(text):
    lines = text.split("\n")
    has_div = any(re.match(r"^:::+\s*(\{[^}]*\.exercise\b|exercise\b)", l) for l in lines)
    out, in_code, box = [], None, None
    for line in lines:
        if in_code:
            out.append(line)
            if re.match(r"^" + re.escape(in_code[0]) + "{" + str(len(in_code)) + r",}\s*$", line):
                in_code = None
            continue
        m = re.match(r"^(```+|~~~+)", line)
        if m:
            in_code = m.group(1)
            out.append(header(line))
            continue
        h = re.match(r"^(#{1,6})\s", line)
        level = len(h.group(1)) if h else None
        if not has_div:
            rule = re.match(r"^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$", line.strip()) and line.strip()
            if box and ((level and level <= box) or rule):
                while out and out[-1] == "":
                    out.pop()
                out += [":::", ""]
                box = None
            if not box and level and level <= 3 and re.match(r"^#+\s+Exercise", line):
                out += ["::: exercise", ""]
                box = level
        out.append(line)
    if box:
        while out and out[-1] == "":
            out.pop()
        out += [":::", ""]
    return "\n".join(out)


for path in sys.argv[1:]:
    with open(path) as f:
        text = f.read()
    new = convert(text)
    if new != text:
        with open(path, "w") as f:
            f.write(new)
        print("converted", path)
