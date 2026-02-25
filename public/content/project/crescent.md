---
label: "crescent"
description: "comprehensive LuaJIT ecosystem — stdlib, typechecker, package manager"
url: https://github.com/rhi-zone/crescent
parent: ecosystem/rhi
status: planned
tags: [lua, infrastructure]
---

a monorepo of composable LuaJIT libraries. vendorable: copy what you need into your project and own it.

## what it is

LuaJIT is the fastest scripting runtime with the best FFI. what it doesn't have is an ecosystem. crescent is that ecosystem — stdlib, typechecker, vendor-first package manager.

pure Lua first, FFI only when necessary. every library is readable, modifiable, yours. inspired by [thi.ng/umbrella](https://thi.ng/umbrella).

## Related projects

- [moonlet](/project/moonlet) - normalize integration with Lua; crescent is bare LuaJIT
- [zone](/project/zone) - Lua-based tools and orchestration
