import Test.QuickCheck
import Data.Char (isSpace)

segments :: (a -> Bool) -> [a] -> [[a]]
segments p [] = []
segments p xs = takeWhile p xs : segments p (drop 1 (dropWhile p xs))

words' :: String -> [String]
words' s = filter (/= "") (segments (not . isSpace) s)

prop_words :: String -> Bool
prop_words s = words' s == words s

prop_takeDrop :: Fun Int Bool -> [Int] -> Bool
prop_takeDrop (Fun _ p) xs = takeWhile p xs ++ dropWhile p xs == xs

>>> quickCheck prop_words
>>> quickCheck prop_takeDrop
