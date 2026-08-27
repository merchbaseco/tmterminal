---
title: Which client to use
---

# Which client to use

Four ways to do the same three jobs: search, get one mark, screen listing text.

| Client | Use it when | Auth |
| --- | --- | --- |
| [Website](https://tmterminal.merchbase.co/search) | You are reading results | Clerk session |
| [CLI](/cli) (`tt`) | A shell or a script | API key |
| [HTTP client](/http-client) | A TypeScript app | API key or session |
| [MCP](/mcp) | An agent | Clerk OAuth, not an API key |

Pick one. Do not wrap the website. Types and errors come from the server router; the published client and CLI do not invent their own DTOs.

Package READMEs stay the install-at-the-package copy. This section is the narrative.
