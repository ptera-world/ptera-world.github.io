Discord bot for collaborative worldbuilding and roleplay. Entity-facts model with declarative response control, multi-provider LLM integration, and Nunjucks templating.

## What it is

Everything in hologram is an **entity** with **facts**. Characters, locations, items, help topics - all represented the same way. Responses are controlled via declarative `$respond` directives (always/never/conditional) and `$if` expressions for rate limiting, mention detection, random triggers.

Features:

- **Multi-character** - XML tag-based or name-prefix formatting for multiple entities in one channel
- **15+ LLM providers** - Anthropic, OpenAI, Google, Groq, Mistral, xAI, DeepSeek, Cohere, Cerebras, Perplexity, Together AI, Fireworks, DeepInfra, Hugging Face, Amazon Bedrock, and more via unified `provider:model` spec
- **Streaming responses** - configurable chunking strategies
- **Custom templates** - per-entity Nunjucks templates with inheritance and role blocks
- **Fact evaluation** - JavaScript runtime for context variables (mentioned, replied, content, author, time, channel, server)
- **Model override** - per-entity `$model` directive with allowlist
- **Tool system** - fact manipulation via LLM tool calls with permission checks
- **Bindings** - Discord channels/users/servers map to entities for persona dispatch

Built with Bun, Discordeno, Vercel AI SDK v6, and bun:sqlite.

## Related projects

- [aspect](/aspect) - identity exploration sandbox; cards could become hologram entities
