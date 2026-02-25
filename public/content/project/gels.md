---
label: "gels"
description: "detects the shape of languages"
url: https://docs.rhi.zone/gels
parent: ecosystem/rhi
status: planned
tags: [rust, cli, ai]
---

trait-based grammar inference engine targeting tree-sitter output. detects syntactic traits from example source files, identifies known languages, or synthesizes tree-sitter grammars for unknown ones.

## what it is

examples get tokenized, traits get detected, and the result is either a language identification or a fresh grammar. syntactic features like brace-delimited blocks, semicolon-terminated statements, and pattern matching are independent detectors. detected traits contribute grammar fragments that merge into a complete tree-sitter grammar.

## Related projects

- [normalize](/project/normalize) - structural code intelligence that complements grammar detection
