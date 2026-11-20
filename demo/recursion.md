---
title: "Recursion on lists"
---

*A sample page to try out the format: a short text "lecture" with
examples and exercises.*

A list in Haskell is either empty, `[]`, or an element in front of
another list, `x : xs`. Every list is built this way: `[1, 2, 3]` is
just a short way to write `1 : (2 : (3 : []))`.

```haskell {.run}
>>> 1 : (2 : (3 : []))
>>> 'h' : "ello"
>>> :t (:)
```

## Functions that follow the shape of a list

Because a list is either `[]` or `x : xs`, a function on lists usually
has two equations: one for the empty list, and one for a list with a
first element `x` and a rest `xs`. In the second equation we may use
the function itself on `xs`, which is a shorter list. That is recursion.

```haskell {.run}
size :: [a] -> Int
size []       = 0
size (x : xs) = 1 + size xs

>>> size "hello"
>>> size []
```

To see how this computes, unfold it step by step:

```haskell
size "abc"
  = 1 + size "bc"
  = 1 + (1 + size "c")
  = 1 + (1 + (1 + size ""))
  = 1 + (1 + (1 + 0))
  = 3
```

The same pattern gives many functions. Here are two more: one that
builds a new list, and one that keeps only some of the elements.

```haskell {.run}
squares :: [Integer] -> [Integer]
squares []       = []
squares (x : xs) = x * x : squares xs

evens :: [Integer] -> [Integer]
evens [] = []
evens (x : xs)
  | even x    = x : evens xs
  | otherwise = evens xs

>>> squares [1 .. 5]
>>> evens [1 .. 10]
```

## A common mistake

What happens if we forget the equation for the empty list? Run this and
read the error. Then add the missing equation and run it again.

```haskell {.run}
total :: [Integer] -> Integer
total (x : xs) = x + total xs

>>> total [1, 2, 3]
```

GHC accepts the definition, but every call eventually reaches `total []`,
for which there is no equation. With warnings on (`-Wall`, as in the
labs) GHC tells you about this before you run anything:

```haskell {.run}
{-# OPTIONS_GHC -Wall #-}
total :: [Integer] -> Integer
total (x : xs) = x + total xs

>>> total [1, 2, 3]
```

::: exercise

## Exercises

### 1. Doubling

Define `doubleAll`, which doubles every number in a list.

```haskell {.exercise}
doubleAll :: [Integer] -> [Integer]
doubleAll xs = undefined

>>> doubleAll [1, 2, 3]
```

```haskell {.check}
import Test.QuickCheck

prop_doubleAll :: [Integer] -> Bool
prop_doubleAll xs = doubleAll xs == map (* 2) xs

>>> quickCheck prop_doubleAll
```

```haskell {.solution}
doubleAll :: [Integer] -> [Integer]
doubleAll []       = []
doubleAll (x : xs) = 2 * x : doubleAll xs
```

### 2. Is it there?

Define `member x xs`, which is `True` if `x` occurs in `xs`. Do not use
`elem`: write the recursion yourself.

```haskell {.exercise}
member :: Eq a => a -> [a] -> Bool
member x xs = undefined

>>> member 3 [1, 2, 3]
>>> member 'z' "haskell"
```

```haskell {.check}
import Test.QuickCheck

prop_member :: Int -> [Int] -> Bool
prop_member x xs = member x xs == elem x xs

prop_member_found :: Int -> [Int] -> [Int] -> Bool
prop_member_found x ys zs = member x (ys ++ [x] ++ zs)

>>> quickCheck prop_member
>>> quickCheck prop_member_found
```

```haskell {.solution}
member :: Eq a => a -> [a] -> Bool
member x []       = False
member x (y : ys) = x == y || member x ys
```

### 3. Merging sorted lists

Define `merge`, which combines two sorted lists into one sorted list.
Here the recursion is on two lists at once: compare their first
elements.

```haskell {.exercise}
merge :: [Int] -> [Int] -> [Int]
merge xs ys = undefined

>>> merge [1, 4, 9] [2, 3, 10]
```

```haskell {.check}
import Test.QuickCheck
import Data.List (sort)

prop_merge :: [Int] -> [Int] -> Bool
prop_merge xs ys = merge (sort xs) (sort ys) == sort (xs ++ ys)

>>> quickCheck prop_merge
```

```haskell {.solution}
merge :: [Int] -> [Int] -> [Int]
merge [] ys = ys
merge xs [] = xs
merge (x : xs) (y : ys)
  | x <= y    = x : merge xs (y : ys)
  | otherwise = y : merge (x : xs) ys
```
:::
