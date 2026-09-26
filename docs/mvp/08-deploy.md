# 08 · Deploy: public on Vercel

**Owner:** Workstream C (Vercel project, env vars); A (production Supabase project).
**Depends on:** everything; do a first deploy of the empty app in hour 1 to prove the pipeline.
**Exposes:** a public URL anyone can play with.

## Steps

1. **Supabase (A):** production project set up as in 02 (schema, optional example seed, then real data via 07). Pick a region near the Vercel function region (e.g. Supabase `eu-west-2` London ↔ Vercel `lhr1`).
2. **GitHub:** the repo is public at https://github.com/pwilkk/haggle-v2.
3. **Vercel project**, either:
   - **Dashboard:** vercel.com → Add New → Project → import `pwilkk/haggle-v2` → framework auto-detected (Next.js), build `npm run build`, install `npm install` → add env vars (below) → Deploy. Every push to `main` then deploys production; PRs get preview URLs.
   - **CLI:** from a clone of `https://github.com/pwilkk/haggle-v2`: `npx vercel` (log in, link the project, creates a preview deploy) → add env vars (`npx vercel env add XAI_API_KEY production`, repeat per key, or use the dashboard) → `npx vercel --prod`.
4. **Env vars** (Project → Settings → Environment Variables), for Production (and Preview if you use previews):

   | Name | Value | Notes |
   |---|---|---|
   | `XAI_API_KEY` | your xAI key | mark Sensitive |
   | `XAI_MODEL` | `grok-4.7` | optional, default in code |
   | `XAI_BASE_URL` | `https://api.x.ai/v1` | optional, default in code |
   | `SUPABASE_URL` | project URL | |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key | mark Sensitive. **Server-only** |

   Never prefix any of these with `NEXT_PUBLIC_` (that would ship them to every browser). Env var changes need a redeploy; **data changes never do** (07).
   Previews and production share the same Supabase project unless you create a second one, so a sale on a preview is a sale everywhere.
5. **Function region:** Settings → Functions → region next to Supabase.
6. **Smoke test the production URL:** one chat to matches, one negotiation to Agreed, check the stream arrives turn by turn (not all at the end). Then check the client bundle has no secrets: DevTools → Sources, search for `SUPABASE` / `XAI` → nothing.

## Designed for many anonymous visitors

| Concern | Design |
|---|---|
| Who is the buyer? | Nobody logs in. Each browser generates a random UUID `sessionId` in `localStorage` and sends it with every request; nothing else is stored in the browser (a refresh starts a fresh chat). `requests` and `negotiations` rows carry `session_id`; routes return 404 for another session's rows. Header shows "You (buyer)". |
| Shared catalogue | All visitors see the same listings. **Sold is final:** Accept marks the listing `sold` for everyone, permanently; no demo mode, no undo. Restock by inserting listings/sellers in Supabase (07). |
| Two visitors, one listing | **Busy lock** (01 §5): Negotiate atomically locks the listing for 2 min for that session; others get "Someone is haggling for this one, try again shortly" and see it marked "Busy". Released on failed / walk away / accept, otherwise expires. Only the lock holder can accept, so there's never a race to buy. |
| Live data | All four routes are `POST` handlers, which Next.js never caches, and they read Supabase on every call. No `use cache`, no memoised catalogue. Build output should list the API routes as dynamic (ƒ). |
| Long negotiation stream | `export const maxDuration = 60` on `/api/negotiate` (6 LLM turns + 600 ms pacing ≈ 20–30 s); within Vercel's default limits. |
| Cost / abuse | KISS caps in code (01): message ≤ 500 chars, ≤ 30 messages per chat, ≤ 10 negotiations per session → `400`/`429`. `sessionId` is client-chosen, so these are speed bumps, not security. **The real guard is a monthly spending limit on the xAI account; set one before sharing the URL.** |
| Per-IP rate limit | Not built. In-memory counters don't work across serverless instances, so don't write one. If the URL gets hammered, add a rate-limit rule for `/api/*` in the Vercel Firewall (dashboard, no code), or rotate the xAI key. |
| Secrets | Supabase and xAI keys live only in Vercel env vars and server code (`lib/db.ts`, `lib/llm.ts`, both server-only). RLS with no policies means even a leaked anon key reads nothing. |
| Idle Supabase | Free-tier projects pause after about a week without traffic; open the dashboard before sharing the link. |

## Done when

- [ ] Public production URL works from a phone on mobile data (no localhost assumptions).
- [ ] Two browsers (or one normal + one private window) chat and negotiate independently; neither sees the other's request.
- [ ] While one browser haggles, the other's Negotiate on the same listing shows "Someone is haggling for this one, try again shortly"; after walk away / failure it works.
- [ ] Accepting in one browser makes the listing disappear from the other's next matches.
- [ ] A listing inserted in Supabase appears in production matches on the next message without a redeploy.
- [ ] Caps return 400/429 as specified; xAI spending limit set.
- [ ] No secret in the client bundle.
