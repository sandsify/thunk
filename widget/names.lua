-- Pandoc filter, run first: brings a page to the current format, and
-- stops the build when a block is in the wrong place.
--
-- Older names, still accepted:
--   {.haskell .exercise .open}  is  {.haskell .tryit}
--   {.haskell .hidden}          is  {.haskell .setup}
--   {.haskell .try}             is  {.haskell .attempt}
--   a ## or ### heading starting with "Exercise" (down to the next
--   heading of the same or a higher level, or a horizontal rule) is
--   ::: exercise ... ::: , but only on a page with no ::: exercise.
--
-- Checks, in page order:
--   .check and .solution directly after an .exercise or .tryit block (or
--   after its other .check or .solution);
--   .expect and .attempt somewhere after a runnable block, and
--   {.expect action=check} only for an exercise.

local renames = { hidden = "setup", try = "attempt" }

local function rename(b)
  local classes = pandoc.List()
  for _, c in ipairs(b.classes) do classes:insert(renames[c] or c) end
  if classes:includes("exercise") and classes:includes("open") then
    classes = classes:filter(function(c) return c ~= "exercise" and c ~= "open" end)
    classes:insert("tryit")
  end
  b.classes = classes
  return b
end

local function fail(msg)
  io.stderr:write("names.lua: " .. msg .. "\n")
  os.exit(1)
end

local function code(b, class) return b.t == "CodeBlock" and b.classes:includes(class) end
local function runnable(b) return code(b, "run") or code(b, "exercise") or code(b, "tryit") end

-- The old exercise boxes, from headings.
local function heading_boxes(blocks)
  local out, box, level = {}, nil, nil
  for _, b in ipairs(blocks) do
    local l = b.t == "Header" and b.level or nil
    if box and ((l and l <= level) or b.t == "HorizontalRule") then
      table.insert(out, pandoc.Div(box, { class = "exercise" }))
      box = nil
    end
    if not box and l and l <= 3 and pandoc.utils.stringify(b):match("^Exercise") then
      box, level = { b }, l
    elseif box then
      table.insert(box, b)
    else
      table.insert(out, b)
    end
  end
  if box then table.insert(out, pandoc.Div(box, { class = "exercise" })) end
  return out
end

-- The code blocks in page order, through divs.
local function code_blocks(blocks, out)
  for _, b in ipairs(blocks) do
    if b.t == "CodeBlock" then table.insert(out, b)
    elseif b.t == "Div" then code_blocks(b.content, out) end
  end
  return out
end

local function check(blocks)
  local last, prev = nil, nil -- the last runnable block, and the block before
  for _, b in ipairs(code_blocks(blocks, {})) do
    if code(b, "check") or code(b, "solution") then
      local ok = prev and (code(prev, "exercise") or code(prev, "tryit")
        or code(prev, "check") or code(prev, "solution"))
      if not ok then
        fail("a ." .. (code(b, "check") and "check" or "solution") ..
          " block must come right after its .exercise or .tryit block:\n" .. b.text:sub(1, 200))
      end
    elseif code(b, "expect") or code(b, "attempt") then
      if not last then
        fail("an ." .. (code(b, "expect") and "expect" or "attempt") ..
          " block must come after the block it tests:\n" .. b.text:sub(1, 200))
      end
      if code(b, "expect") and b.attributes.action == "check" and code(last, "run") then
        fail("{.expect action=check} after a .run block, which has no Check:\n" .. b.text:sub(1, 200))
      end
    end
    if runnable(b) then last = b end
    prev = b
  end
end

function Pandoc(doc)
  doc = doc:walk({ CodeBlock = rename })
  local has_div = false
  doc:walk({ Div = function(d) if d.classes:includes("exercise") then has_div = true end end })
  if not has_div then doc.blocks = heading_boxes(doc.blocks) end
  check(doc.blocks)
  return doc
end
