---
title: "Demo: functions on lists"
---

Every code box on this page can be edited and run. Lines starting with
`>>>` are evaluated as in GHCi; everything else is ordinary Haskell
definitions. You do not need a `main`.

## An example

Here is a recursive function that sums a list. Try changing the inputs,
or add your own `>>>` lines. `>>> :t` shows the type of an expression.

```{.haskell .run}
total :: [Integer] -> Integer
total []       = 0
total (x : xs) = x + total xs

>>> total [1, 2, 3, 4]
>>> total []
>>> :t total
```

What happens if you call it with a list of `Bool`s? Add the line
`>>> total [True, False]` and run it again.

## Exercise

Define `count` so that `count x xs` is the number of times `x` occurs in
`xs`. For example, `count 'a' "banana"` is `3`.

Use **Run** to try your definition, and **Check** to test it with
QuickCheck.

```{.haskell .exercise}
count :: Eq a => a -> [a] -> Int
count x xs = undefined

>>> count 'a' "banana"
```

```{.haskell .check}
import Test.QuickCheck

prop_count :: Int -> [Int] -> Bool
prop_count x xs = count x xs == length (filter (== x) xs)

>>> quickCheck prop_count
```

```{.haskell .solution}
count :: Eq a => a -> [a] -> Int
count x xs = length (filter (== x) xs)
```

A static code block, for comparison (not runnable):

```haskell
count x xs = length [y | y <- xs, y == x]
```
