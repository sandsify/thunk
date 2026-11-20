-- Pandoc filter for the Canvas version of a page (widget/build-canvas.sh).
-- Runs after names.lua and before filter.lua. The mode is the metadata
-- field hs-mode:
--
--   embed   keep only runnable block number hs-block (counted from 1, in
--           page order), with its check and solution blocks and the setup
--           blocks before it: a page with just that one block, for an iframe.
--   canvas  replace every runnable block with an iframe showing
--           hs-base/NAME/N.html, drop the setup, check and solution
--           blocks, and turn the page's extras (title, abstract, contents,
--           exercises, hints, notes) into plain Markdown with inline
--           styles, for a Markdown-to-LMS converter such as mkdocstocanvas.
--           Other ::: divs keep only their contents.
--
-- Runnable blocks are the top-level .run and .exercise blocks.

local function is_hs(b, class)
  return b.t == "CodeBlock" and b.classes:includes("haskell") and b.classes:includes(class)
end
local function runnable(b) return is_hs(b, "run") or is_hs(b, "exercise") or is_hs(b, "tryit") end
local function attached(b) return is_hs(b, "check") or is_hs(b, "solution") end
local function is_test(b)
  return b.t == "CodeBlock" and (b.classes:includes("expect") or b.classes:includes("attempt"))
end

-- An estimate of the block's height in pixels in the split layout, used as
-- the iframe's height until the block reports its real height.
local function height(b)
  local defs, inputs = 0, 0
  for line in (b.text .. "\n"):gmatch("([^\n]*)\n") do
    if line:match("^>>>") or line:match("^%.%.%.") then inputs = inputs + 1 else defs = defs + 1 end
  end
  local h = 60 -- the button bar
  if defs > 0 then h = h + 16 + 22 * defs end
  h = h + 16 + 33 * math.max(inputs, 1) -- inputs, before any output
  if is_hs(b, "exercise") or is_hs(b, "tryit") then h = h + 24 end
  return math.floor(h + 8)
end

local function escape(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

-- An exercise (::: exercise) becomes a box: a <div markdown="1"> with
-- inline styles (Canvas keeps those, not classes; mkdocstocanvas reads the
-- Markdown inside, with md_in_html). The page is flattened, so that the
-- blocks inside an exercise are counted like the others.
local box_style = "background: #fdf3f8; border: 1px solid #efc3d9; " ..
  "border-radius: 8px; padding: 2px 16px 12px; margin: 24px 0;"

local function flatten(blocks, with_boxes)
  local out = {}
  for _, b in ipairs(blocks) do
    if b.t == "Div" and b.classes:includes("exercise") then
      if with_boxes then table.insert(out, pandoc.RawBlock("html", '<div markdown="1" style="' .. box_style .. '">')) end
      for _, inner in ipairs(flatten(b.content, with_boxes)) do table.insert(out, inner) end
      if with_boxes then table.insert(out, pandoc.RawBlock("html", "</div>")) end
    else
      table.insert(out, b)
    end
  end
  return out
end

local function embed(doc, n)
  local out, count, i = {}, 0, 1
  local blocks = flatten(doc.blocks, false)
  -- The text since the last heading: the block page has no text of its
  -- own, but the AI hints need the exercise (notes.js reads it from here).
  local text = {}
  local next_hidden = {} -- .setup .next blocks (open and .secret), for the next runnable block only
  while i <= #blocks do
    local b = blocks[i]
    if b.t == "Header" and b.level <= 3 then
      text = {b}
    elseif b.t ~= "CodeBlock" or not (b.classes:includes("haskell") or is_test(b)) then
      table.insert(text, b)
    end
    if runnable(b) then
      count = count + 1
      if count == n then for _, h in ipairs(next_hidden) do table.insert(out, h) end end
      next_hidden = {}
      if count == n then
        local plain = pandoc.write(pandoc.Pandoc(text), "plain", {wrap_text = "none"})
        table.insert(out, pandoc.RawBlock("html",
          '<textarea class="hs-context-text" hidden>' .. escape(plain) .. '</textarea>'))
        table.insert(out, b)
        while blocks[i + 1] and attached(blocks[i + 1]) do
          table.insert(out, blocks[i + 1]); i = i + 1
        end
        break
      end
    elseif is_hs(b, "setup") and b.classes:includes("next") then
      table.insert(next_hidden, b)
    elseif is_hs(b, "setup") then
      table.insert(out, b)
    end
    i = i + 1
  end
  if count ~= n then
    io.stderr:write("canvas.lua: the page has no runnable block " .. n .. "\n")
    os.exit(1)
  end
  doc.blocks = out
  doc.meta.title = nil
  doc.meta.abstract = nil
  doc.meta.contents = nil
  return doc
end

-- The contents: the ## headings only (mkdocstocanvas's [TOC] lists every
-- level). The anchors are the ids Python-Markdown's toc extension gives the
-- headings: ASCII, lower case, punctuation dropped, spaces to "-".
local function slug(text)
  local s = text:gsub("[\128-\255]", ""):gsub("[^%w%s_-]", ""):lower()
  s = s:gsub("^%s+", ""):gsub("%s+$", ""):gsub("[-%s]+", "-")
  return s
end

-- $ too: mkdocstocanvas reads a bare $ outside code as the start of inline
-- math, up to the next $ anywhere in the page, and leaves everything in
-- between unconverted (IL 2B's "the $ operator" heading, 2026-11-11).
local function html_escape(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub("%$", "&#36;"))
end

local function contents(blocks)
  local items = {}
  for _, b in ipairs(blocks) do
    if b.t == "Header" and b.level == 2 then
      local text = pandoc.utils.stringify(b)
      table.insert(items, string.format('<li><a href="#%s">%s</a></li>', slug(text), html_escape(text)))
    end
  end
  return pandoc.RawBlock("html", '<div class="toc"><p><strong>Contents</strong></p><ul>\n' ..
    table.concat(items, "\n") .. "\n</ul></div>")
end

local function canvas(doc, base, name)
  local out, count = {}, 0
  local meta = doc.meta
  if meta.title then
    table.insert(out, pandoc.Header(1, pandoc.utils.type(meta.title) == "Inlines"
      and meta.title or pandoc.Inlines(pandoc.utils.stringify(meta.title))))
  end
  if meta.abstract then
    -- folded away (details/summary, which Canvas keeps), under the
    -- abstract-title of the page (default "About this page")
    local abs = meta.abstract
    local blocks = pandoc.utils.type(abs) == "Blocks" and abs or pandoc.Blocks{pandoc.Plain(abs)}
    table.insert(out, pandoc.RawBlock("html", '<details markdown="1"><summary>' ..
      escape(meta["abstract-title"] and pandoc.utils.stringify(meta["abstract-title"]) or "About this page") .. '</summary>'))
    for _, b in ipairs(blocks) do
      if b.t == "Plain" then table.insert(out, pandoc.Para(b.content)) else table.insert(out, b) end
    end
    table.insert(out, pandoc.RawBlock("html", "</details>"))
  end
  doc.blocks = flatten(doc.blocks, true)
  if meta.contents then table.insert(out, contents(doc.blocks)) end
  -- Setup code for the next block (.setup .next) changes that block too.
  local pending = ""
  for idx, b in ipairs(doc.blocks) do
    if is_hs(b, "setup") then pending = pending .. b.text end
    if runnable(b) then
      count = count + 1
      local kind = runnable(b) and not is_hs(b, "run") and "exercise" or "example"
      -- ?v=: a version from the block's code (with its check, solution and
      -- hidden code), so that a browser fetches the block page again when
      -- the block changes (the server sends no caching headers, and a
      -- renumbered page showed an old block from the cache).
      local key = pending .. b.text
      local j = idx + 1
      while doc.blocks[j] and attached(doc.blocks[j]) do
        key = key .. doc.blocks[j].text; j = j + 1
      end
      pending = ""
      table.insert(out, pandoc.RawBlock("html", string.format(
        '<iframe src="%s/%s/%d.html?v=%s" title="Haskell %s %d" width="100%%" height="%d" ' ..
        'style="border: 0; width: 100%%;" loading="lazy"></iframe>',
        base, name, count, pandoc.utils.sha1(key):sub(1, 8), kind, count, height(b))))
    elseif is_hs(b, "setup") or attached(b) or is_test(b) then
      -- not shown; the block pages include them
    elseif b.t == "Div" and b.classes:includes("hint") then
      -- folded away under "Hint" (Canvas keeps details/summary and inline styles)
      table.insert(out, pandoc.RawBlock("html",
        '<details markdown="1" style="margin: 8px 0 16px; padding: 4px 12px; ' ..
        'border-left: 3px solid #6f9fd6; background: #eef5fd; border-radius: 4px;">' ..
        '<summary style="cursor: pointer; font-weight: 600;">Hint</summary>'))
      for _, inner in ipairs(b.content) do table.insert(out, inner) end
      table.insert(out, pandoc.RawBlock("html", "</details>"))
    elseif b.t == "Div" and b.classes:includes("note") then
      -- a boxed note, with its title (inline styles, as for the exercises)
      table.insert(out, pandoc.RawBlock("html",
        '<div markdown="1" style="margin: 16px 0; padding: 2px 16px; ' ..
        'border: 1px solid #6f9fd6; border-left-width: 4px; background: #eef5fd; border-radius: 4px;">'))
      if b.attributes.title then
        table.insert(out, pandoc.Para{pandoc.Strong{pandoc.Str(b.attributes.title)}})
      end
      for _, inner in ipairs(b.content) do table.insert(out, inner) end
      table.insert(out, pandoc.RawBlock("html", "</div>"))
    elseif b.t == "Div" then
      for _, inner in ipairs(b.content) do table.insert(out, inner) end
    else
      table.insert(out, b)
    end
  end
  doc.blocks = out
  doc.meta = pandoc.Meta{}
  return doc
end

function Pandoc(doc)
  local mode = pandoc.utils.stringify(doc.meta["hs-mode"] or "")
  if mode == "embed" then
    return embed(doc, tonumber(pandoc.utils.stringify(doc.meta["hs-block"])))
  elseif mode == "canvas" then
    return canvas(doc, pandoc.utils.stringify(doc.meta["hs-base"]),
      pandoc.utils.stringify(doc.meta["hs-name"]))
  end
  return doc
end
