-- json encode/decode. lua 5.1 / luajit, no deps.
local M = {}

M.null = setmetatable({}, { __tostring = function() return "null" end })
local function array(t) return setmetatable(t, { __jsonarray = true }) end
M.array = array

local esc = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
local function encode(v)
  local t = type(v)
  if v == M.null or v == nil then return "null" end
  if t == "boolean" then return tostring(v) end
  if t == "number" then return string.format("%.14g", v) end
  if t == "string" then
    return '"' .. v:gsub('[%c"\\]', function(c) return esc[c] or string.format("\\u%04x", c:byte()) end) .. '"'
  end
  local mt = getmetatable(v)
  local isarr = (mt and mt.__jsonarray) or (#v > 0 and next(v, #v) == nil)
  local out = {}
  if isarr then
    for i = 1, #v do out[i] = encode(v[i]) end
    return "[" .. table.concat(out, ",") .. "]"
  end
  for k, x in pairs(v) do out[#out + 1] = encode(tostring(k)) .. ":" .. encode(x) end
  return "{" .. table.concat(out, ",") .. "}"
end
M.encode = encode

local function decode(s)
  local pos = 1
  local function ws() pos = s:find("%S", pos) or #s + 1 end
  local val
  local function str()
    local out, i = {}, pos + 1
    while true do
      local c = s:sub(i, i)
      if c == "" then error("unterminated string") end
      if c == '"' then pos = i + 1; return table.concat(out) end
      if c == "\\" then
        local n = s:sub(i + 1, i + 1)
        if n == "u" then
          local cp = tonumber(s:sub(i + 2, i + 5), 16)
          i = i + 6
          if cp >= 0xD800 and cp <= 0xDBFF and s:sub(i, i + 1) == "\\u" then
            cp = 0x10000 + (cp - 0xD800) * 0x400 + (tonumber(s:sub(i + 2, i + 5), 16) - 0xDC00)
            i = i + 6
          end
          if cp < 0x80 then out[#out + 1] = string.char(cp)
          elseif cp < 0x800 then out[#out + 1] = string.char(0xC0 + cp / 64, 0x80 + cp % 64)
          elseif cp < 0x10000 then out[#out + 1] = string.char(0xE0 + cp / 4096, 0x80 + cp / 64 % 64, 0x80 + cp % 64)
          else out[#out + 1] = string.char(0xF0 + cp / 262144, 0x80 + cp / 4096 % 64, 0x80 + cp / 64 % 64, 0x80 + cp % 64) end
        else
          out[#out + 1] = ({ b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" })[n] or n
          i = i + 2
        end
      else
        out[#out + 1] = c
        i = i + 1
      end
    end
  end
  function val()
    ws()
    local c = s:sub(pos, pos)
    if c == "{" then
      local o = {}
      pos = pos + 1; ws()
      if s:sub(pos, pos) == "}" then pos = pos + 1; return o end
      while true do
        ws(); local k = str(); ws()
        assert(s:sub(pos, pos) == ":", "expected :"); pos = pos + 1
        o[k] = val(); ws()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == "}" then return o end
        assert(d == ",", "expected , or }")
      end
    elseif c == "[" then
      local a = array({})
      pos = pos + 1; ws()
      if s:sub(pos, pos) == "]" then pos = pos + 1; return a end
      while true do
        a[#a + 1] = val(); ws()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == "]" then return a end
        assert(d == ",", "expected , or ]")
      end
    elseif c == '"' then return str()
    elseif s:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
    elseif s:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
    elseif s:sub(pos, pos + 3) == "null" then pos = pos + 4; return M.null
    else
      local n = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
      if not n or n == "" then error("bad json at " .. pos) end
      pos = pos + #n
      return tonumber(n)
    end
  end
  return val()
end
M.decode = decode

return M
