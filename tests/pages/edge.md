---
title: "Edge cases"
---

Not a demo: blocks for tests/visual.mjs.

```{.haskell .run}
{-# LANGUAGE LambdaCase #-}
import Data.Char (toUpper)

shout :: String -> String
shout = map toUpper

f :: Int -> String
f = \case { 0 -> "zero"; _ -> "other" }

>>> shout "hi"
>>> f 0
```

```{.haskell .exercise}
module Main where

import Data.List (sort)

sorted :: [Int] -> [Int]
sorted = sort

>>> sorted [3, 1, 2]
```

```{.haskell .check}
import Test.QuickCheck

prop_sorted :: [Int] -> Bool
prop_sorted xs = and (zipWith (<=) ys (drop 1 ys)) where ys = sorted xs

>>> quickCheck prop_sorted
```

```{.haskell .run}
-- Ends without a newline, and GHCi commands
>>> :i Maybe
>>> :k Either
>>> let x = 5
>>> x * 2
```

```{.haskell .run}
{-# OPTIONS_GHC -Wall #-}
-- A warning only: the results are still shown
g x = x

>>> g 'a'
```

```{.haskell .run}
>>> :{
>>> let y = 2
>>> in y * 3
>>> :}
>>> y
```

Hidden setup code: applies to the blocks after it.

```{.haskell .hidden}
import Data.Char (isDigit)

twice :: (a -> a) -> a -> a
twice f = f . f
```

```{.haskell .run}
>>> twice (+ 1) 5
>>> filter isDigit "a1b2"
```

Program input: lines starting with `<<<` after an input are what the
program reads.

```{.haskell .run}
greet :: IO ()
greet = do
  name <- getLine
  putStrLn ("Hello, " ++ name ++ "!")

>>> greet
<<< Ada
>>> do { a <- getLine; b <- getLine; print (a ++ b) }
<<< one
<<< two
>>> 1 + 1
```

The language-first fence form, and doctest's `prop>` in the tests.

```haskell {.exercise}
count :: Char -> String -> Int
count c s = undefined

>>> count 'a' "banana"
```

```haskell {.check}
prop> \c s -> count c s == length (filter (== c) s)
prop> \s -> count 'x' ('x' : s) >= 1
```

```haskell {.solution}
count :: Char -> String -> Int
count c s = length (filter (== c) s)
```

```haskell {.try}
count :: Char -> String -> Int
count c s = 1
```

```expect {action=check}
Not yet: a test failed.
prop> \c s -> count c s == length (filter (== c) s)
*** Failed! Falsified (after [...]):
[...]
```
