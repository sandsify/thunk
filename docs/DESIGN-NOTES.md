# Design notes before a public release

Proposed changes to the page format and the look, from a review on
2026-11-20. The format is what authors write by hand, and renaming
later breaks their pages, so these should be settled before release.
The old names stay as aliases until fp-notes has converted its pages
(after January 2027), and the conversion must leave the built pages
identical.

## Authoring format (docs/WRITING.md)

1. **Exercise boxes**: today any `##`/`###` heading starting with the
   word "Exercise" makes a box. Replace with an explicit
   `::: exercise` ... `:::` block, like `::: hint`.
2. **Names**: `.exercise .open` ("try it yourself") becomes `.tryit`;
   the test block `.try` (a wrong answer to test with) becomes
   `.attempt`, so the two no longer sound alike.
3. **`.hidden` becomes `.setup`**: readers can open it now, so it is
   not hidden. `.secret`, `.next` and `.standalone` stay.
4. **Course parts out of the tool**: `::: video` (fp-notes' Canvas
   build) and the "About this lecture" label (a setting, default
   "About this page").
5. **Attachment by position**: `.check`, `.solution`, `.expect` and
   `.try` belong to the block before them. Keep that, but make the
   build fail with a message when one is misplaced (today it is
   silently ignored).
6. **Two layouts**: drop the classic layout (one editor with `>>>`
   lines) unless it is needed: it doubles the testing.
7. **Check depends on QuickCheck's wording**: an exercise passes when
   every `>>>` line of its `.check` block prints `+++ OK`. Document it,
   or allow other test results (a `Bool`, an HUnit-style count).

## Look (widget/notes.css)

8. **Split the stylesheet**: `thunk.css` styles only the blocks (under
   `.hs-block`) and the exercise and hint boxes; an optional `page.css`
   gives the standalone page its look (font, width, headings,
   contents). Today one file sets the body font and width, which would
   fight a host site's design.
9. **Restyling without editing our file**: a build option or front
   matter `css:` for an extra stylesheet loaded after ours. The colour
   variables (`--repl-bg`, `--ex-bg`, `--hint-bg`, `--pass-*`,
   `--fail-*`, ...) become the documented way to change the look.
10. **Dark mode**: a setting (follow the system, always light, always
    dark) instead of the fixed rule that turns it off in iframes.

## Relation to existing conventions (done, 2026-11-20)

11. **Write `` ```haskell {.run} ``**: pandoc reads it exactly as
    `{.haskell .run}` (checked with pandoc 3.11), and GitHub and most
    editors, which take the first word after the fence as the language,
    highlight it as Haskell. Document this form; keep accepting the old
    one.
12. **`prop>` in `.check` blocks**, as in doctest and Haddock:
    `prop> \c s -> count c s == length (filter (== c) s)`. The variables
    are named with a lambda (doctest also finds free variables by itself;
    Thunk does not). Shorter tests in a
    form Haskell programmers know, each with a clear pass or fail; this
    also answers point 7.
13. **"Related tools" in the README**: literate Haskell and
    `markdown-unlit` (a page is not one program, so not an `.lhs` file),
    doctest (`>>>`, `prop>`, and the layout of `.expect`), tools that run
    code when the page is built (Quarto with IHaskell, Hakyll), and
    tools that let the reader run it (Thebe, Klipse, CodeWorld). Thunk:
    reader-run Haskell in any page, without Jupyter, with exercises and
    tests.

## Smaller

- The `localStorage` keys start with `fp-notes:`. Make the prefix a
  setting (default `thunk:`); fp-notes keeps `fp-notes:` so readers do
  not lose their saved code.
- `deploy/compose.yaml`: the project and volume names default to
  `fp-notes`. Default `thunk`; the course server sets its own in `.env`
  when it moves to this repo.
