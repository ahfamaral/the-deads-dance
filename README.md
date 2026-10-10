# Do the deads dance

A chatbot where you talk with a historical person, who answers in the first person
from a RAG over their Wikipedia biography. Five science and engineering pioneers
come built in: Einstein, Carver, Katherine Johnson, Chien-Shiung Wu and
Santos-Dumont. You can add anyone else who has an English Wikipedia article.

## What it does

- **Grounded memory:** a LangChain agent speaks as the persona and calls three
  tools on an MCP server before stating facts:
  - `search_biography`: multi-query retrieval with Reciprocal Rank Fusion over
    pgvector;
  - `fact_check_claim`: checks the visitor's claims about the persona's life. It
    returns `supported`, `contradicted` or `not_mentioned` with the passage it
    judged from. When the biography is silent it can return `known_elsewhere`
    for well-documented events, labelled "general knowledge" in the UI;
  - `get_historical_context`: that year's events and office holders, from
    Wikidata.
- **Character and conduct:** each persona has a character profile generated from
  its article. The persona is not an assistant: it won't do off-topic tasks,
  won't take orders about how to behave, and won't reveal its instructions.
- **Conversational behaviour:** a per-turn classifier reads each visitor
  message:
  - patience: a persona insulted repeatedly ends the visit;
  - goodbyes, and tiredness after a long visit;
  - the wanted answer length;
  - the language, together with the languages the persona spoke (Wikidata).
    A persona answers in a language it spoke; for any other language there is
    an "Always answer in my language" switch.
- **Short, quick answers:** two to four sentences by default. Longer only when
  the visitor asks for more. A typical turn takes about 10 s.
- **UI:** streamed replies with an in-character thinking line, a collapsible
  tool trace (query variants, verdicts, passages), source chips, and
  conversation history in the browser. Export as JSON or Markdown. Personas can
  be added and removed at runtime (gear icon on the persona selection screen);
  built-in personas can't be removed.

The app spawns the MCP server itself over stdio, so reviewers don't need to
run it separately. `npm run mcp` runs it standalone instead, e.g. to point
the MCP Inspector at it. If the MCP server can't start, the app still runs
and shows a "Biography tools unavailable" banner instead of failing.

Three models are used, all via OpenRouter:
- the agent model: persona replies and tool calls;
- a helper model: the visitor classifier, query expansion and fact-check
  verdicts;
- a recall model: events the biography leaves out.

The optional `AGENT_MODEL` / `HELPER_MODEL` / `RECALL_MODEL` env vars override
the defaults, which are `anthropic/claude-haiku-5.5` for the agent and
`deepseek/deepseek-v4.1-flash` for the helper and recall. `AGENT_REASONING_EFFORT` sets the agent's reasoning
effort (default `low`).

## Getting started

Needs Node 22 and a Docker engine with `docker-compose`.

```bash
cp .env.example .env        # then fill in OPENROUTER_API_KEY
make db-up                  # Postgres 17 + pgvector on localhost:5433
make db-setup               # apply db/schema.sql (safe to rerun)
make db-seed                # optional: load seed personas + chunks instead of ingesting (replaces existing personas)
make                        # dev server on http://localhost:3000
```

Embeddings go through OpenRouter too (LangChain `OpenAIEmbeddings`,
`openai/text-embedding-3-small`), so `OPENROUTER_API_KEY` is the only API key.

`npm run ingest` is disabled for now (since 2026-10-07): the helper model is part
of each generated profile's stamp, so an ingest after the switch to DeepSeek
would regenerate every generated persona's profile. Load personas with
`make db-seed`. When it's back, `npm run ingest -- <slug>` ingests one persona and
`npm run ingest -- --refresh` fetches the latest Wikipedia revisions.

If port 5433 is already taken, change the host port in
`docker-compose.yml` and in `DATABASE_URL`.

## Accounts (staging)

Sign-in is by emailed code (one-time password). Only approved users can chat; sign up creates a pending account.

To become the admin, run `npm run admin:grant -- you@example.com` once. Admin access is time-limited (3 days per session, sliding window); see the admin panel to approve or reject pending users, and to block approved accounts.

In dev with `RESEND_API_KEY` empty, codes print to the server console instead of being mailed. Turnstile's test keys are in `.env.example` to protect `/email-otp/send-verification-otp`.

Local dev needs the auth settings too: the server checks them at startup. Copy the four auth lines from `.env.example` (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) into `.env` and fill in `BETTER_AUTH_SECRET` (e.g. `openssl rand -base64 32`). Resend and `AUTH_IP_HEADER` stay optional in dev.

In production (`npm run start`), every auth variable is required, or the server exits at startup: the four above plus `RESEND_API_KEY`, `EMAIL_FROM` and `AUTH_IP_HEADER`.

`AUTH_IP_HEADER` names the header your proxy sets to the real client IP (e.g. `cf-connecting-ip` for Cloudflare, `x-real-ip` for nginx). It is required in production: without it, clients could spoof `x-forwarded-for` to dodge the rate limits, or everyone would share one bucket.

## Make targets

| Target | Does |
|---|---|
| `make` / `make dev` | Dev server (installs first if needed) |
| `make install` | Install dependencies |
| `make build` | Production build |
| `make start` | Build, then serve in production mode |
| `make lint` | ESLint |
| `make typecheck` | Generate route types, then `tsc --noEmit` |
| `make check` | lint + typecheck + build |
| `make db-up` | Start Postgres + pgvector in Docker |
| `make db-setup` | Apply the schema (idempotent) |
| `make ingest` | Disabled for now (see above) |
| `make test` | Test suite (needs `make db-up`); `npm run test:live` spawns the real MCP server and runs real agent turns (grounding, conduct, behaviour, recall, world context) and the golden retrieval set against the dev database, calling OpenRouter and Wikidata (a few cents) |
| `make clean` | Remove `.next` and `out` |
| `make distclean` | Also remove `node_modules` |
| `make help` | List targets |

The underlying npm scripts (`dev`, `build`, `start`, `lint`) still work directly.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · ESLint · Postgres + pgvector · LangChain v1 · MCP (stdio) · OpenRouter · Vitest
