// Steps for tests/visual.mjs. Blocks are numbered from 0 in page order.
// A step: {name, block, reload?, code?, click?, js?, expect?, reject?}.
// expect/reject are matched against the block's output text after the
// click, or against the value of the js expression.

const countRight = `count :: Eq a => a -> [a] -> Int
count x xs = length (filter (== x) xs)

>>> count 'a' "banana"`;

export const scenarios = [
  {
    page: "demo.html",
    steps: [
      { name: "example-run", block: 0, click: "Run",
        expect: /^>>> total \[1, 2, 3, 4\]\n10\n>>> total \[\]\n0\n>>> :t total\ntotal :: \[Integer\] -> Integer/ },
      { name: "example-type-error", block: 0, click: "Run",
        code: "total :: [Integer] -> Integer\ntotal []       = 0\ntotal (x : xs) = x + total xs\n\n>>> total [True, False]",
        expect: /No instance for .Num Bool|Couldn't match/ },
      { name: "explain-run-error", block: 0,
        js: "(async () => { const b = document.querySelectorAll('.hs-block')[0]; const btn = b.querySelector('.hs-explain'); if (!btn) return 'no button'; btn.click(); for (let t = 0; t < 80; t++) { await new Promise((r) => setTimeout(r, 100)); const ok = b.querySelector('.hs-hint-consent button'); if (ok) ok.click(); const h = b.querySelector('.hs-hint'); if (h) return h.innerText; } return 'none'; })()",
        expect: /^AI explanation \(it may be wrong\)/ },
      { name: "exercise-run-undefined", block: 1, click: "Run", expect: /Prelude\.undefined/ },
      { name: "exercise-check-undefined", block: 1, click: "Check", expect: /^Not yet/ },
      { name: "exercise-check-wrong", block: 1, click: "Check",
        code: countRight.replace("==", "/="), expect: /^Not yet[\s\S]*Falsified/ },
      { name: "solution-hidden-before-pass", block: 1, js: "(localStorage.removeItem('thunk:passed:' + location.pathname + ':2'), 'cleared')",
        expect: /^cleared$/ },
      { name: "solution-hidden", block: 1, reload: true,
        js: "[...document.querySelectorAll('.hs-block')[1].querySelectorAll('button')].find((b) => b.textContent === 'Show solution').hidden",
        expect: /^true$/ },
      { name: "hint-consent-cleared", block: 1, js: "(localStorage.removeItem('thunk:hint-consent'), 'cleared')",
        expect: /^cleared$/ },
      { name: "hint-asks-consent", block: 1, click: "Hint",
        expect: /^Not yet[\s\S]*Falsified[\s\S]*Hints are written by an AI model, Google's Gemini/ },
      { name: "hint-after-consent", block: 1,
        js: "(async () => { const b = document.querySelectorAll('.hs-block')[1]; b.querySelector('.hs-hint-consent button').click(); for (let t = 0; t < 80; t++) { await new Promise((r) => setTimeout(r, 100)); const h = b.querySelector('.hs-hint'); if (h) return h.innerText; } return 'none'; })()",
        expect: /^AI hint \(it may be wrong\)\s+Look at the counterexample[\s\S]*More help/ },
      { name: "hint-markdown", block: 1,
        js: "document.querySelectorAll('.hs-block')[1].querySelector('.hs-hint-body').innerHTML",
        expect: /^<p>Look at the counterexample: what does your <code>count<\/code> give for <strong>it<\/strong>\? &lt;b&gt;x&lt;\/b&gt;<\/p><ul><li>one<\/li><li>two<\/li><\/ul>$/ },
      { name: "hint-more-help", block: 1,
        js: "(async () => { const b = document.querySelectorAll('.hs-block')[1]; b.querySelector('.hs-more').click(); for (let t = 0; t < 80; t++) { await new Promise((r) => setTimeout(r, 100)); const h = b.querySelectorAll('.hs-hint'); if (h.length >= 2) return h[1].innerText; } return 'none'; })()",
        expect: /^AI hint 2 \(it may be wrong\)/ },
      { name: "exercise-box", block: 1,
        js: "document.querySelectorAll('.hs-block')[1].closest('.exercise') ? 'boxed' : 'not boxed'",
        expect: /^boxed$/ },
      { name: "exercise-check-compile-error", block: 1, click: "Check",
        code: "count :: Eq a => a -> [a] -> Int\ncount x xs = x ++ xs",
        expect: /Main\.hs:2:14: error[\s\S]*2 \| count x xs = x \+\+ xs/ },
      { name: "hint-compile-error", block: 1, click: "Hint",
        js: "(async () => { const b = document.querySelectorAll('.hs-block')[1]; for (let t = 0; t < 80; t++) { await new Promise((r) => setTimeout(r, 100)); const h = b.querySelector('.hs-hint'); if (h) return h.innerText; } return 'none'; })()",
        expect: /^AI hint \(it may be wrong\)/ },
      { name: "exercise-run-right", block: 1, click: "Run", code: countRight, expect: /^>>> count 'a' "banana"\n3\s*$/ },
      { name: "exercise-check-right", block: 1, click: "Check", expect: /^All tests passed\.$/ },
      { name: "solution-offered-after-pass", block: 1,
        js: "[...document.querySelectorAll('.hs-block')[1].querySelectorAll('button')].find((b) => b.textContent === 'Show solution').hidden",
        expect: /^false$/ },
      { name: "hint-style", block: 1, click: "Hint",
        js: "(async () => { const b = document.querySelectorAll('.hs-block')[1]; for (let t = 0; t < 80; t++) { await new Promise((r) => setTimeout(r, 100)); const h = b.querySelector('.hs-hint'); if (h) return h.innerText + (b.querySelector('.hs-more') ? ' MORE' : ''); } return 'none'; })()",
        expect: /^AI feedback on style \(it may be wrong\)\s+Look at/ },
      { name: "edit-marks-output-stale", block: 1, code: countRight + "\n>>> count 1 [1,1]",
        js: "document.querySelectorAll('.hs-block')[1].className", expect: /hs-stale/ },
      { name: "edit-kept-after-reload", block: 1, reload: true,
        js: "[document.querySelectorAll('.hs-block')[1].hs.getCode().includes('>>> count 1 [1,1]'), !document.querySelectorAll('.hs-note')[1].hidden].join()",
        expect: /^true,true$/ },
      { name: "solution-shown", block: 1, click: "Show solution",
        js: "document.querySelector('.hs-solution') && document.querySelector('.hs-solution').innerText",
        expect: /filter \(== x\) xs/ },
      { name: "reset", block: 1, click: "Reset",
        js: "[document.querySelectorAll('.hs-block')[1].hs.getCode().includes('undefined'), document.querySelectorAll('.hs-note')[1].hidden].join()",
        expect: /^true,true$/ },
    ],
  },
  {
    page: "notebook.html",
    steps: [
      { name: "shapes-run", block: 0, click: "Run", expect: /^>>> area \(Rectangle 3 4\)\n12\.0\n/ },
      { name: "uses-earlier-block", block: 1, click: "Run",
        expect: /\[Rectangle 1\.0 1\.0,Rectangle 3\.0 2\.0,Circle 2\.0\]\n>>> let total[\s\S]*\.\.\.\s+in \(total, average\)\n\(19\.56\d*,6\.52\d*\)\n>>> :t sortOn/ },
      { name: "error-in-earlier-block", block: 1, click: "Run",
        code: undefined, setBefore: true },
      { name: "exercise-check-undefined", block: 2, click: "Check", expect: /^Not yet/ },
      { name: "exercise-check-right", block: 2, click: "Check",
        code: "perimeter :: Shape -> Double\nperimeter (Circle r) = 2 * pi * r\nperimeter (Rectangle w h) = 2 * (w + h)",
        expect: /^All tests passed\.$/ },
      { name: "exercise-check-other-order", block: 2, click: "Check",
        code: "perimeter :: Shape -> Double\nperimeter (Circle r) = r * pi * 2\nperimeter (Rectangle w h) = w + w + h + h",
        expect: /^All tests passed\.$/ },
      { name: "timeout-keeps-earlier", block: 3, click: "Run",
        expect: /^(Explain this error\n)?>>> take 5 \[1 \.\.\]\n\[1,2,3,4,5\]\n>>> length \[1 \.\.\]\n\*\*\* Stopped/ },
      { name: "io", block: 4, click: "Run", expect: /Hello, Chalmers!\n>>> mapM_[\s\S]*Hello, Ada!\nHello, Haskell!/ },
      { name: "edit-dims-later-blocks", block: 0, code: "-- edited\n" + "x = 1",
        js: "[...document.querySelectorAll('.hs-block')].map((b) => b.classList.contains('hs-stale')).join()",
        expect: /^true,true,true,true,true$/ },
    ],
  },
];

// A step that breaks block 0 and runs block 1, then repairs block 0.
const nb = scenarios[1].steps;
const i = nb.findIndex((s) => s.name === "error-in-earlier-block");
const shapes = `data Shape = Circle Double | Rectangle Double Double
  deriving Show

area :: Shape -> Double
area (Circle r)      = pi * r * r
area (Rectangle w h) = w * h

>>> area (Rectangle 3 4)
>>> map area [Circle 1, Rectangle 2 5]`;
nb.splice(i, 1,
  { name: "break-block-1", block: 0, code: shapes.replace("w * h", "w * True") },
  { name: "error-in-earlier-block", block: 1, click: "Run", expect: /^block 1:6:\d+(-\d+)?: error[\s\S]*6 \| area \(Rectangle w h\) = w \* True/ },
  { name: "repair-block-1", block: 0, code: shapes },
);

scenarios.push({
  page: "edge.html",
  steps: [
    { name: "language-pragma-with-imports", block: 0, click: "Run", expect: /^>>> shout "hi"\n"HI"\n>>> f 0\n"zero"/ },
    { name: "module-header-run", block: 1, click: "Run", expect: /^>>> sorted \[3, 1, 2\]\n\[1,2,3\]/ },
    { name: "module-header-check", block: 1, click: "Check", expect: /^All tests passed\.$/ },
    { name: "ghci-commands", block: 2, click: "Run",
      expect: /data Maybe a = Nothing \| Just a[\s\S]*>>> :k Either\nEither :: \* -> \* -> \*\n>>> let x = 5\n>>> x \* 2\n10/ },
    { name: "warning-and-results", block: 3, click: "Run",
      expect: /Main\.hs:3:1: warning[\s\S]*Top-level binding with no type signature[\s\S]*>>> g 'a'\n'a'/ },
    { name: "explicit-block", block: 4, click: "Run", expect: /^>>> let y = 2\n\.\.\. in y \* 3\n6\n>>> y\n[\s\S]*Variable not in scope: y/ },
    { name: "hidden-setup", block: 5, click: "Run", expect: /^>>> twice \(\+ 1\) 5\n7\n>>> filter isDigit "a1b2"\n"12"/ },
    { name: "hidden-setup-clash", block: 5, click: "Run", code: "twice :: Int\ntwice = 2\n\n>>> twice",
      expect: /Multiple declarations of .twice.[\s\S]*setup:4:1/ },
    { name: "program-input", block: 6, click: "Run",
      expect: /^>>> greet\n<<< Ada\nHello, Ada!\n>>> do \{ a <- getLine; b <- getLine; print \(a \+\+ b\) \}\n<<< one\n<<< two\n"onetwo"\n>>> 1 \+ 1\n2/ },
  ],
});

scenarios.push({
  page: "recursion.html",
  steps: [
    { name: "cons", block: 0, click: "Run", expect: /^>>> 1 : \(2 : \(3 : \[\]\)\)\n\[1,2,3\]\n>>> 'h' : "ello"\n"hello"\n>>> :t \(:\)\n\(:\) :: a -> \[a\] -> \[a\]/ },
    { name: "size", block: 1, click: "Run", expect: /^>>> size "hello"\n5\n>>> size \[\]\n0/ },
    { name: "squares-evens", block: 2, click: "Run", expect: /\[1,4,9,16,25\]\n>>> evens \[1 \.\. 10\]\n\[2,4,6,8,10\]/ },
    { name: "missing-base-case", block: 3, click: "Run", expect: /Non-exhaustive patterns in function total/ },
    { name: "missing-base-case-wall", block: 4, click: "Run", expect: /warning[\s\S]*Pattern match\(es\) are non-exhaustive[\s\S]*Patterns of type .\[Integer\]. not matched: \[\]/ },
    { name: "exercise-member-run", block: 6, click: "Run", expect: /Prelude\.undefined/ },
    { name: "exercise-merge-wrong", block: 7, click: "Check",
      code: "merge :: [Int] -> [Int] -> [Int]\nmerge xs ys = xs ++ ys", expect: /^Not yet[\s\S]*Falsified/ },
  ],
});
