---
title: "Writing pages with Thunk"
---

A Thunk page is an ordinary Markdown file (pandoc's Markdown). Most of
it is text. Haskell code blocks that carry a class become boxes readers
can edit and run. Everything else on the page is left as it is.

Pages written with older names (`.hidden`, `.try`, `.exercise .open`,
exercise boxes from headings) still work; `tools/convert-names.py`
converts them.

Code blocks are written with the language first, as in
```` ```haskell {.run} ````: pandoc reads the class in braces, and GitHub
and most editors highlight the block as Haskell. (```` ```{.haskell .run} ````
means the same to pandoc.)

Build a page with

    widget/build.sh page.md out/            # out/page.html

## 1. A runnable example

````markdown
```haskell {.run}
double :: Int -> Int
double x = 2 * x

>>> double 21
>>> map double [1, 2, 3]
```
````

The reader gets an editor with a **Run** button. The definitions are in
the editor; each `>>>` line is one GHCi input, shown in a panel below
the editor with a `>` prompt, and its result appears under it after
Run. Readers can change both and run again; **Reset** restores the
original.

The rules for inputs:

- `>>> expr` is one input; it can be anything GHCi accepts, such as
  `:t map` or `:i Maybe`.
- `... more` continues the input on the line before (for long
  expressions).
- `>>> :{` … `>>> :}` is one input over several lines, as in GHCi (for
  a `let` or a local definition).
- `<<< text` after an input is a line the program reads from standard
  input, for examples with `getLine` or `interact`.

A block can have only definitions (Run then just compiles them) or only
inputs.

## 2. An exercise

An exercise is a block for the reader's answer, followed by its tests
and, if you like, a solution:

````markdown
::: exercise
### Exercise: count

Define `count c s`, the number of times `c` occurs in `s`.

```haskell {.exercise}
count :: Char -> String -> Int
count c s = undefined

>>> count 'a' "banana"
```

```haskell {.check}
prop> \c s -> count c s == length (filter (== c) s)
```

```haskell {.solution}
count :: Char -> String -> Int
count c s = length (filter (== c) s)
```
:::
````

- `::: exercise` ... `:::`: the exercise, drawn as a coloured box. It
  holds the text, any hints, and the blocks.
- `.exercise`: like `.run`, plus a **Check** button.
- `.check`: the tests, never shown. Check compiles the reader's
  definitions together with this block and runs its tests. Each
  `prop>` line is a QuickCheck property, as in doctest; name its
  variables with a lambda (`\c s -> ...`). The reader sees "All tests
  passed." or the failing property with its counterexample.
  A `.check` block can also hold ordinary definitions and `>>>` lines
  (for example `>>> quickCheckWith stdArgs { maxSuccess = 500 } prop`):
  each `>>>` line must print QuickCheck's `+++ OK` to pass.
  `Test.QuickCheck` is imported for you when there are `prop>` lines.
- `.solution`: offered once the reader has passed (or asks to see it).
  Leave it out if there should be none.

The `.check` and `.solution` blocks belong to the `.exercise` block just
before them; the build stops with a message if one is anywhere else.

### Try it yourself

In the middle of an explanation, "try writing this before reading on"
is an exercise without a box, whose definition is on offer from the
start (**Show definition**):

````markdown
```haskell {.tryit}
...
```
````

It can have `.check` and `.solution` blocks like an exercise.

## 3. Hints

````markdown
::: hint
Think of `filter` first, then count what is left.
:::
````

A hint is folded away under "Hint" until the reader opens it.

`::: {.note title="Terminology"}` ... `:::` is a boxed note with a
title.

## 4. Code the reader does not need to see

When many examples use the same data type or helper functions,
repeating them in every box buries the new code. Put them in a setup
block instead:

````markdown
```haskell {.setup}
data Shape = Circle Double | Rect Double Double
  deriving Show
```
````

A `.setup` block goes before every runnable block after it on the
page, but is not shown in it. Each box that gets setup code shows a
folded line, **Hidden code:** `Shape, ...`, which opens it read-only.

- `.setup .next`: only for the next runnable block. Several `.next`
  blocks in a row all go to that block.
- `.secret` (with `.setup`, and optionally `.next`): runs, but is never
  shown or listed. For a doctored helper or a fake file system, not
  for anything the reader should understand.
- `.standalone` on a runnable block: it gets none of the shared setup
  code, only `.setup .next` blocks just before it. For an example that
  has nothing to do with the code around it.

Imports may go in setup code; they are moved to the top of the
program. A good rule: use setup code for three lines or more of
repetition, and keep visible whatever the box is about.

## 5. Page settings

At the top of the page, in YAML:

```yaml
---
title: "Recursion on lists"
abstract: |
  A short description, shown folded under "About this page".
abstract-title: "About this lecture"   # instead of "About this page"
contents: true      # a table of contents of the ## headings
notebook: true      # each block also sees the definitions above it
qr: true            # a QR code of the page's own address
theme: light        # or dark; by default the reader's system setting
css: my-site.css    # extra stylesheets, after Thunk's (a list is fine)
storage-prefix: my-course   # where readers' edits are kept (default thunk)
---
```

All are optional. In a notebook page, a block can use what earlier
blocks define, as in a Jupyter notebook; the same name cannot be
defined twice.

Settings for all pages of a site go in a YAML file, given to the build
as `THUNK_METADATA=site.yaml`; a page's own settings win.

## 6. Changing the look

`widget/thunk.css` styles the blocks, exercise boxes and hints;
`widget/page.css` gives a standalone page its font, width and contents
box (leave it out when the blocks are part of another site). The
colours are variables, so a stylesheet given with `css:` only needs to
override some of them:

```css
:root {
  --repl-bg: #eef4ff;     /* the GHCi input panel */
  --ex-bg: #fffbea;       /* exercise boxes */
  --ex-line: #f0d98c;
}
```

The others: `--bg`, `--fg`, `--muted`, `--line`, `--code-bg`,
`--accent` (buttons, links), `--repl-line`, `--hint-bg`, `--hint-line`,
`--pass-bg`, `--pass-line`, `--fail-bg`, `--fail-line`, `--error`. For
dark mode, override them under `:root[data-theme="dark"]` and inside
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }`.

A site's own `::: name` blocks can be handled by its own pandoc Lua
filter, given as `THUNK_FILTERS=my-filter.lua`.

## 7. Testing a page

A page can carry its own tests, which readers never see and which
`tests/visual.mjs` runs in a browser:

````markdown
```expect
>>> double 21
42
```

```haskell {.attempt}
count c s = 0
```

```expect {action=check}
Not yet: a test failed.
[...]
```
````

- `.expect` after a runnable block: what Run should show, inputs
  included. `[...]` stands for any text.
- `.expect action=check`: the same for Check.
- `.attempt`: code to put in the block first (typically a wrong
  answer); the `.expect` blocks after it apply to that code.

Every exercise's `.solution` is also checked: it must pass its tests.

## 8. Building for an LMS

`widget/build-canvas.sh page.md out/ BASE_URL` writes a Markdown version
of the page in which each runnable block is an iframe (one small page
per block, served from `BASE_URL`), for systems such as Canvas that
accept iframes but not scripts. Block pages are light unless the page
sets `theme`. A `css:` stylesheet must then be given as an absolute
address, since the block pages are one folder down.

## 9. A page without a server (replay mode)

A page can also be published with its results recorded, for a demo
that should not put load on a server, or as a fallback:

```bash
node tools/record-replay.mjs page.md          # writes page.replay.json
THUNK_REPLAY=page.replay.json widget/build.sh page.md out/
```

The recorder opens the page against a running Thunk and presses what a
reader starts with: Run on every block, Check on every exercise, Check
and Run with each solution, and the page's own `.attempt` and `.expect`
tests (section 7). It keeps Thunk's answer for each program sent. In the
built page, those programs get the recorded answers; any other program,
that is, code the reader has changed, gets a note that it needs a
server. So a suggestion in the text ("add the input
`total [True, False]`") works without a server if the page also has it
as an `.attempt`. The reader has to make exactly that change.

With a server address as well
(`THUNK_REPLAY=... widget/build.sh page.md out/ https://thunk.example.org`),
the recorded programs still come from the recording, and only changed
code goes to the server. Record again after changing the page's code:
a program that is not in the recording needs a server. The Hint button
needs the hint service, so a page without a server has none.
