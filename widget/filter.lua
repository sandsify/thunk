-- Pandoc filter: turns marked Haskell code blocks into placeholders that
-- notes.js makes interactive. Runs after names.lua, which accepts older
-- names and checks the order of the blocks. The format is described in
-- docs/WRITING.md.
--
--   ```haskell {.run}        editable example with a Run button
--   ```haskell {.exercise}   editable, with Run and Check buttons
--   ```haskell {.check}      tests for the exercise just before it
--   ```haskell {.solution}   a solution for that exercise, shown on request
--   ```haskell {.tryit}      "try it yourself" in the text: an exercise
--                            whose definition is offered from the start
--   ```haskell {.setup}      setup code that goes before every runnable
--                            block after it (imports, definitions); readers
--                            can open it, read-only
--     .next                  only for the next runnable block
--     .secret                readers cannot open it
--   .standalone on a runnable block: no shared .setup code, only the
--                            .setup .next code just before it
--   ::: exercise             an exercise, drawn as a box
--   ::: hint                 a hint, folded away ("Hint")
--   ::: {.note title="..."}  a boxed note with a title
--   ```expect, ```haskell {.attempt}
--                            tests for tests/visual.mjs (tests/expect.mjs):
--                            dropped
--
-- With the environment variable HS_NO_SOLUTIONS=1, .solution blocks are
-- left out of the page altogether (for a page that asks for the answer
-- in class, the page must not contain it).
--
-- Other code blocks are left alone.

local function escape(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

local function block(kind, code, extra, open, standalone)
  local html = '<div class="hs-block" data-kind="' .. kind .. '"'
    .. (open and ' data-open="1"' or '')
    .. (standalone and ' data-standalone="1"' or '') .. '>\n'
    .. '<textarea class="hs-code">' .. escape(code) .. '</textarea>\n'
  for _, name in ipairs({"check", "solution"}) do
    if extra and extra[name] then
      html = html .. '<textarea class="hs-' .. name .. '" hidden>' .. escape(extra[name]) .. '</textarea>\n'
    end
  end
  return html .. '</div>'
end

function Blocks(blocks)
  local out = {}
  local i = 1
  while i <= #blocks do
    local b = blocks[i]
    if b.t == "CodeBlock" and (b.classes:includes("expect") or b.classes:includes("attempt")) then
      -- a test, not for readers
    elseif b.t == "CodeBlock" and b.classes:includes("haskell") then
      if b.classes:includes("setup") then
        -- .next: only for the next runnable block (e.g. a definition the
        -- reader was asked to write, needed again further on)
        table.insert(out, pandoc.RawBlock("html",
          '<textarea class="hs-hidden"' .. (b.classes:includes("next") and ' data-next="1"' or '')
          .. (b.classes:includes("secret") and ' data-secret="1"' or '')
          .. ' hidden>' .. escape(b.text) .. '</textarea>'))
      elseif b.classes:includes("run") then
        table.insert(out, pandoc.RawBlock("html", block("run", b.text, nil, false, b.classes:includes("standalone"))))
      elseif b.classes:includes("exercise") or b.classes:includes("tryit") then
        -- the check and solution blocks that follow it, in any order
        local extra = {}
        while true do
          local nxt = blocks[i + 1]
          local name = nxt and nxt.t == "CodeBlock" and
            (nxt.classes:includes("check") and "check" or nxt.classes:includes("solution") and "solution")
          if not name or extra[name] then break end
          extra[name] = nxt.text
          i = i + 1
        end
        -- HS_NO_SOLUTIONS=1: the solution stays out of the page, not even
        -- hidden in it
        if os.getenv("HS_NO_SOLUTIONS") == "1" then extra.solution = nil end
        table.insert(out, pandoc.RawBlock("html",
          block("exercise", b.text, extra, b.classes:includes("tryit"), b.classes:includes("standalone"))))
      elseif b.classes:includes("check") or b.classes:includes("solution") then
        io.stderr:write("filter.lua: check and solution blocks must follow an exercise block\n")
        os.exit(1)
      else
        table.insert(out, b)
      end
    else
      table.insert(out, b)
    end
    i = i + 1
  end
  return out
end

-- ::: hint ... ::: is a hint folded away under "Hint".
-- ::: {.note title="Terminology"} ... ::: is a boxed note, with its title.
function Div(d)
  if d.classes:includes("note") then
    local out = {pandoc.RawBlock("html", '<div class="note">')}
    if d.attributes.title then
      table.insert(out, pandoc.Para{pandoc.Strong{pandoc.Str(d.attributes.title)}})
    end
    for _, b in ipairs(d.content) do table.insert(out, b) end
    table.insert(out, pandoc.RawBlock("html", "</div>"))
    return out
  end
  if d.classes:includes("hint") then
    local out = {pandoc.RawBlock("html", '<details class="hint"><summary>Hint</summary>')}
    for _, b in ipairs(d.content) do table.insert(out, b) end
    table.insert(out, pandoc.RawBlock("html", "</details>"))
    return out
  end
end
