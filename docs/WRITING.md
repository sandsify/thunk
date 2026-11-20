---
title: "Writing pages with Thunk"
---

A Thunk page is an ordinary Markdown file (pandoc's Markdown). Most of
it is text. Haskell code blocks that carry a class become boxes readers
can edit and run. Everything else on the page is left as it is.

This describes the format as it is now. Names that may change before a
public release are marked *(may change)*; see `DESIGN-NOTES.md`.

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
````

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
before them.

A heading that starts with "Exercise" (`##` or `###`) puts everything
up to the next heading of the same level in a coloured exercise box.
*(may change: an explicit `::: exercise` block)*

### Try it yourself

In the middle of an explanation, "try writing this before reading on"
is an exercise without a box, whose definition is on offer from the
start (**Show definition**):

````markdown
```haskell {.exercise .open}
...
```
````

*(may change: `.tryit`)*

## 3. Hints

````markdown
::: hint
Think of `filter` first, then count what is left.
:::
````

A hint is folded away under "Hint" until the reader opens it.

## 4. Code the reader does not need to see

When many examples use the same data type or helper functions,
repeating them in every box buries the new code. Put them in a hidden
block instead:

````markdown
```haskell {.hidden}
data Shape = Circle Double | Rect Double Double
  deriving Show
```
````

A `.hidden` block goes before every runnable block after it on the
page. Each box that gets hidden code shows a folded line,
**Hidden code:** `Shape, ...`, which opens it read-only. *(may change:
`.setup`)*

- `.hidden .next`: only for the next runnable block. Several `.next`
  blocks in a row all go to that block.
- `.secret` (with `.hidden`, and optionally `.next`): runs, but is never
  shown or listed. For a doctored helper or a fake file system, not
  for anything the reader should understand.
- `.standalone` on a `.run` or `.exercise` block: it gets none of the
  shared hidden code, only `.hidden .next` blocks just before it. For an
  example that has nothing to do with the code around it.

Imports may go in hidden code; they are moved to the top of the
program.

## 5. Page settings

At the top of the page, in YAML:

```yaml
---
title: "Recursion on lists"
abstract: |
  A short description, shown folded under "About this lecture".
contents: true      # a table of contents of the ## headings
notebook: true      # each block also sees the definitions above it
qr: true            # a QR code of the page's own address
layout: classic     # one editor with the >>> lines in it
---
```

All are optional. In a notebook page, a block can use what earlier
blocks define, as in a Jupyter notebook; the same name cannot be
defined twice. *(`about this lecture` and `layout` may change.)*

## 6. Testing a page

A page can carry its own tests, which readers never see and which
`tests/visual.mjs` runs in a browser:

````markdown
```expect
>>> double 21
42
```

```haskell {.try}
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
- `.try`: code to put in the block first (typically a wrong answer);
  the `.expect` blocks after it apply to that code. *(may change:
  `.attempt`)*

Every exercise's `.solution` is also checked: it must pass its tests.

## 7. Building for an LMS

`widget/build-canvas.sh page.md out/ BASE_URL` writes a Markdown version
of the page in which each runnable block is an iframe (one small page
per block, served from `BASE_URL`), for systems such as Canvas that
accept iframes but not scripts.
