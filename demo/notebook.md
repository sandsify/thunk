---
title: "Demo: a notebook page"
notebook: true
---

On this page each code box also sees the definitions in the boxes above
it, like cells in a notebook. Run the boxes in any order: a box always
uses the current text of the boxes above it.

## A data type

```{.haskell .run}
data Shape = Circle Double | Rectangle Double Double
  deriving Show

area :: Shape -> Double
area (Circle r)      = pi * r * r
area (Rectangle w h) = w * h

>>> area (Rectangle 3 4)
>>> map area [Circle 1, Rectangle 2 5]
```

## Using it

This box uses `Shape` and `area` from the box above. GHCi input can span
several lines: indented lines continue the line before.

```{.haskell .run}
import Data.List (sortOn)

shapes :: [Shape]
shapes = [Rectangle 1 1, Circle 2, Rectangle 3 2]

>>> sortOn area shapes
>>> let total = sum (map area shapes)
...     average = total / fromIntegral (length shapes)
...   in (total, average)
>>> :t sortOn
```

## Exercise: perimeter

Define `perimeter`. The tests compare it with the formulas `2πr` and
`2(w + h)`.

```{.haskell .exercise}
perimeter :: Shape -> Double
perimeter s = undefined

>>> perimeter (Circle 1)
```

```{.haskell .check}
import Test.QuickCheck

-- Doubles are compared approximately: a correct answer computed in a
-- different order can differ in the last digits.
(~=) :: Double -> Double -> Bool
x ~= y = abs (x - y) <= 1e-9 * max 1 (abs x + abs y)

prop_circle :: Double -> Bool
prop_circle r = perimeter (Circle r) ~= (2 * pi * r)

prop_rectangle :: Double -> Double -> Bool
prop_rectangle w h = perimeter (Rectangle w h) ~= (2 * (w + h))

>>> quickCheck prop_circle
>>> quickCheck prop_rectangle
```

## When things go wrong

Infinite output and endless loops are stopped after a few seconds; the
results before them are kept.

```{.haskell .run}
>>> take 5 [1 ..]
>>> length [1 ..]
>>> "not reached"
```

Input and output work as in GHCi:

```{.haskell .run}
greet :: String -> IO ()
greet name = putStrLn ("Hello, " ++ name ++ "!")

>>> greet "Chalmers"
>>> mapM_ greet ["Ada", "Haskell"]
```
