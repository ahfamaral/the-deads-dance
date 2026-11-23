# Do the deads dance

A chatbot where you talk with a historical person, who answers in the first person
from a RAG over their biography. Five science and engineering pioneers come built
in: Einstein, Carver, Katherine Johnson, Chien-Shiung Wu and Santos-Dumont. The
admin can add anyone else who has a Wikipedia article.

Live: https://deadsdance.freitasdoamaral.com (sign-up is open; an admin approves
each account before it can chat).

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
  tool trace (query variants, verdicts, passages) and source chips, which
  translate into the visitor's language on open. Conversations are saved to the
  visitor's account and can be exported as JSON or Markdown. After a
  conversation, visitors can rate it (1–5 stars) and leave a comment. Works on
  phones as well as desktops.
- **Voice:** visitors can speak instead of typing (the browser's speech
  recognition), and the persona can answer aloud in an imagined voice
  (`google/gemini-3.8-flash-tts` via OpenRouter).
- **Richer memory:** for each persona the admin picks the most complete
  Wikipedia edition among the languages the persona spoke (editions are scored
  against 30 visitor questions), plus priced extras: their own writings, real
  quotes, linked articles, and passages on other pages that mention them. Each
  ingestion round is recorded with its per-item costs on the persona's admin
  profile page.
- **Accounts and spend:** sign-in by emailed code, admin approval, and a
  per-visitor budget shown as "energy". The admin panel approves, rejects and
  blocks users, grants energy, shows spend and reads feedback. The admin can
  add, hide and remove personas (gear icon on the persona selection screen);
  built-in personas can't be removed.

The MCP server runs inside the app over an in-memory transport (same protocol,
tools and results as stdio, with no child process, so it runs on serverless).
`npm run mcp` starts it standalone over stdio, e.g. to point the MCP Inspector
at it. If the MCP server can't start, the app still runs and shows a
"Biography tools unavailable" banner instead of failing.

Three models are used, all via OpenRouter:
- the agent model: persona replies and tool calls;
- a helper model: the visitor classifier, query expansion and fact-check
  verdicts;
- a recall model: events the biography leaves out.

The optional `AGENT_MODEL` / `HELPER_MODEL` / `RECALL_MODEL` env vars override
the defaults, which are `anthropic/claude-haiku-5.5` for the agent,
`deepseek/deepseek-v4.1-flash` for the helper and `openai/gpt-6-luna` for recall. `AGENT_REASONING_EFFORT` sets the agent's reasoning
effort (default `low`). The defaults were chosen with the evaluation harness in
`eval/` (`npm run eval`), which scores candidate models and prompts on
grounding, conduct and cost.

## Getting started

Needs Node 22 and a Docker engine with `docker-compose`.

```bash
cp .env.example .env        # then fill in OPENROUTER_API_KEY
make db-up                  # Postgres 17 + pgvector on localhost:5433
make db-setup               # apply db/schema.sql (safe to rerun)
make db-seed                # optional: load seed personas + chunks instead of ingesting (replaces existing personas)
make                        # dev server on http://localhost:3000
```

The seed dumps (`db/seed_personas_chunks_*.sql`) are large and not in this
repository.

Embeddings go through OpenRouter too (LangChain `OpenAIEmbeddings`,
`openai/text-embedding-3-small`), so `OPENROUTER_API_KEY` is the only API key.

Personas are added and reingested from the admin pages (Add persona, and
Change sources on a persona's profile). The older `npm run ingest` command is
disabled for now: its re-embed path doesn't know about the richer sources yet.

If port 5433 is already taken, change the host port in
`docker-compose.yml` and in `DATABASE_URL`.

## Accounts

Sign-in is by emailed code (one-time password). Only approved users can chat; sign up creates a pending account.

To become the admin, run `npm run admin:grant -- you@example.com` once. Admin access is time-limited (3 days per session, sliding window); see the admin panel to approve or reject pending users, and to block approved accounts.

In dev with `RESEND_API_KEY` empty, codes print to the server console instead of being mailed. Turnstile's test keys are in `.env.example` to protect `/email-otp/send-verification-otp`.

Local dev needs the auth settings too: the server checks them at startup. Copy the four auth lines from `.env.example` (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) into `.env` and fill in `BETTER_AUTH_SECRET` (e.g. `openssl rand -base64 32`). Resend and `AUTH_IP_HEADER` stay optional in dev.

In production (`npm run start`), every auth variable is required, or the server exits at startup: the four above plus `RESEND_API_KEY`, `EMAIL_FROM` and `AUTH_IP_HEADER`.

`AUTH_IP_HEADER` names the header your proxy sets to the real client IP (e.g. `cf-connecting-ip` for Cloudflare, `x-real-ip` for nginx). It is required in production: without it, clients could spoof `x-forwarded-for` to dodge the rate limits, or everyone would share one bucket.

## Staging (Vercel + Neon)

Staging runs on Vercel (Hobby) with a Neon (Free) Postgres. Pushing the `staging` branch deploys it; no other branch builds (`vercel.json`). Each build runs `npm run vercel-build`: it applies `db/schema.sql` on `DATABASE_URL_UNPOOLED` (Neon's direct URL), then `next build`. A schema failure stops the deploy. The app itself uses `DATABASE_URL` (Neon's pooled URL) with `DATABASE_POOL_MAX=5`.

The MCP server runs inside the app (in-memory transport), so nothing else needs to be hosted. `npm run mcp` still starts it over stdio for MCP Inspector.

Staging env: everything in "Accounts" above, plus `OPENROUTER_API_KEY` (a staging-only key with its own credit limit), `EMAIL_FROM='Do the deads dance <no-reply@mail.freitasdoamaral.com>'` and `AUTH_IP_HEADER=x-real-ip` (Vercel sets it). Neon's Free plan restores to any point in the last 6 hours; there are no other backups.

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
| `make db-seed` | Load the seed personas and chunks (replaces existing personas) |
| `make ingest` | Disabled for now (see above) |
| `make test` | Test suite (needs `make db-up`); `npm run test:live` spawns the real MCP server and runs real agent turns (grounding, conduct, behaviour, recall, world context) and the golden retrieval set against the dev database, calling OpenRouter and Wikidata (a few cents) |
| `make clean` | Remove `.next` and `out` |
| `make distclean` | Also remove `node_modules` |
| `make help` | List targets |

The underlying npm scripts (`dev`, `build`, `start`, `lint`) still work directly.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · ESLint · Postgres + pgvector · LangChain v1 · MCP · Better Auth · OpenRouter · Vitest · Vercel + Neon

## Licence

No licence is granted: all rights reserved. The code is public to read, but
not to copy, modify or redistribute without permission.
