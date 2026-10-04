-- PreToolUse on Agent: only lily, prose-writer or a fork. A lily or
-- prose-writer always gets an explicit
-- model, and its prompt must carry {{user}}'s words verbatim —
-- `{{user}} said: "..."` — and every such quote must actually appear in a
-- message {{user}} typed.
local dir = arg[0]:match("^(.*)[/\\]") or "."
package.path = dir .. "/../lua/?.lua;" .. package.path
local json = require("json")

local hook = json.decode(io.stdin:read("*a"))
local input = hook.tool_input or {}

local function deny(reason)
  io.stdout:write(json.encode({ hookSpecificOutput = {
    hookEventName = "PreToolUse", permissionDecision = "deny", permissionDecisionReason = reason,
  } }), "\n")
  os.exit(0)
end

-- A fork inherits the whole conversation and always runs on the parent's
-- model, so it needs no model name and no quote: it already has the words.
local fork = input.subagent_type == "fork"

if not fork and input.subagent_type ~= "lily" and input.subagent_type ~= "prose-writer" then
  deny('friends are always lily, prose-writer or a fork. pass subagent_type: "lily", "prose-writer" or "fork" (u passed ' .. (input.subagent_type == nil and "nothing" or tostring(input.subagent_type)) .. ")")
end
if not fork and (type(input.model) ~= "string" or input.model == "") then
  deny("pls u need to pass the model name thx")
end

local MARK = "hey friend, ur a subagent btw :3"
if tostring(input.prompt or ""):find(MARK .. "\n", 1, true) ~= 1 then
  deny("every friend prompt starts with the line: " .. MARK)
end
if fork then os.exit(0) end

local quotes = {}
for q in tostring(input.prompt or ""):gmatch('{{user}} said: "(.-)"') do
  quotes[#quotes + 1] = q
end
if #quotes == 0 then
  deny('no `{{user}} said: "..."` in the prompt. if u cant quote them, its not clear yet. ask, dont send')
end

-- Collect every message {{user}} typed from a transcript file.
local function collect(said, path)
  local f = path and io.open(path)
  if not f then return end
  for line in f:lines() do
    local ok, entry = pcall(json.decode, line)
    if ok and type(entry) == "table" then
      if entry.type == "queue-operation" and type(entry.content) == "string" then
        -- messages sent mid-turn (while a tool call was running) land here, not under type "user".
        said[#said + 1] = entry.content
      end
      local msg = entry.type == "user" and entry.message
      local content = msg and msg.content
      if type(content) == "string" then
        said[#said + 1] = content
      elseif type(content) == "table" then
        for _, part in ipairs(content) do
          if type(part) == "table" and part.type == "text" and type(part.text) == "string" then
            said[#said + 1] = part.text
          end
        end
      end
    end
  end
  f:close()
end

local said = {}
-- hook.transcript_path is the OUTER session's transcript. When this hook
-- runs inside a subagent (hook.agent_id set), the messages {{user}} actually
-- typed into *this* agent's turn live in that agent's own transcript file,
-- a sibling of the outer one at <session_dir>/subagents/agent-<agent_id>.jsonl
-- — not in hook.transcript_path itself, which only holds this agent's
-- task-notification summaries from the outer session's point of view.
if hook.agent_id and hook.transcript_path then
  local session_dir = hook.transcript_path:match("^(.*)%.jsonl$")
  if session_dir then
    collect(said, session_dir .. "/subagents/agent-" .. hook.agent_id .. ".jsonl")
  end
end
collect(said, hook.transcript_path)
local all = table.concat(said, "\n")

for _, q in ipairs(quotes) do
  if not all:find(q, 1, true) then
    deny('{{user}} never said "' .. q .. '". thats my reading, not their words. ask, dont send')
  end
end
