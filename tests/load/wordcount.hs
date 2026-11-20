import Data.List (sort, group)

verse :: String
verse = unlines
  [ "A wise old owl lived in an oak"
  , "The more he saw the less he spoke"
  , "The less he spoke the more he heard"
  , "Why can't we all be like that wise old bird?"
  ]

wordCount :: String -> String
wordCount = unlines
          . map (\(w, n) -> w ++ ": " ++ show n)
          . map (\ws -> (head ws, length ws))
          . group
          . sort
          . words

>>> wordCount "hello clouds\nhello sky"
>>> putStr (wordCount verse)
