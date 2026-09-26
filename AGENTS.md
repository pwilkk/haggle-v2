# AGENTS.md

Rules for coding agents working in this repo.

1. **Read `docs/mvp/` first**: `00-overview.md`, then `01-contracts.md`, then the doc for the files you're touching. Each doc says who owns which files, what it depends on, and when it's done.
2. **Next.js 16 has breaking changes** vs what you may remember. Read the relevant guides in `node_modules/next/dist/docs/` (Route Handlers, caching, streaming) before writing Next.js code. Use npm, not pnpm.
3. **`01-contracts.md` / `lib/schemas.ts` are frozen.** Don't change a type, route, table, column or NDJSON event shape without the humans agreeing; if it changes, update the doc in the same commit.
4. **No marketplace data in code.** Categories, bundles, sellers and listings come from Supabase at request time. Don't hard-code category ids, bundle contents, field lists, sellers or prices in `app/` or `lib/` (test fixtures are fine).
5. **Live reads, no caching.** Don't add `use cache`, `unstable_cache`, memoised catalogues or `globalThis` caches. Routes are POST handlers that read Supabase every call.
6. **Privacy rule.** `floorPrice` goes only to the seller agent's prompt; `maxPrice` only to the buyer agent's prompt and the owning session's own request view. Never in `ListingView`, NDJSON events or the other agent's prompt. Only `getListingPrivate()` in `lib/db.ts` selects `floor_price`.
7. **Limits are code, not prompts.** Negotiation clamps, no-backtracking, accept checks, midpoint and max turns live in `lib/negotiation.ts` and are covered by stub tests. Keep `applyMove` pure.
8. **Server-only secrets.** Supabase and xAI are used only from server code (`import "server-only"`). No `NEXT_PUBLIC_` keys, no browser Supabase client.
9. **Sessions.** Every request/negotiation is keyed by the anonymous `sessionId`; check ownership (404 otherwise).
10. **KISS / YAGNI.** If in doubt, leave it out. No new routes, tables, dependencies or abstractions unless a doc asks for them. Specs over cleverness.
11. Run `npm test` before you say you're done.
