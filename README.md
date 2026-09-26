# Haggle

A marketplace where your AI agent haggles for you. Tell it what you want ("I want black sport shoes", "I want to start cycling"); it asks only for what's missing, finds matching listings, and negotiates live with each seller's AI agent within private limits (your budget, their floor price). You click **Accept deal**.

Repo: https://github.com/pwilkk/haggle-v2 (public).

Public, no sign-up: every browser is an anonymous buyer. Sellers, listings, categories and bundles live in Supabase and are managed directly there.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind v4 · Supabase Postgres · Grok via xAI (`openai` package) · Zod · Vitest · Vercel.

## Setup

```bash
git clone https://github.com/pwilkk/haggle-v2.git && cd haggle-v2
npm install
cp .env.example .env.local      # replace the placeholder values (see below)
```

`.env.local`:

| Key | What |
|---|---|
| `XAI_API_KEY` | xAI API key |
| `XAI_MODEL` | defaults to `grok-4.7` |
| `XAI_BASE_URL` | defaults to `https://api.x.ai/v1` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret key (server-only) |

Database (Supabase dashboard → SQL editor):

1. Run `supabase/schema.sql` (tables, the listing busy-lock functions, RLS).
2. Optional: run `supabase/seed.example.sql` for an example catalogue (shoes + a cycling bundle). The app doesn't depend on it.

Run:

```bash
npm run dev        # http://localhost:3000
npm test           # vitest: matcher, request builder, negotiation limits
```

## Managing the marketplace

Add or edit sellers, listings, categories (and their required/optional fields) and bundles in the Supabase Table Editor or SQL editor. Changes are live on the next chat message, with no redeploy. Accepting a deal marks a listing sold for everyone, permanently; restock by inserting new listings. See [docs/mvp/07-managing-data.md](docs/mvp/07-managing-data.md).

## Deploy

Import `pwilkk/haggle-v2` in Vercel (or `npx vercel`, then `npx vercel --prod`) and set the same env vars there. See [docs/mvp/08-deploy.md](docs/mvp/08-deploy.md).

## Docs

Build spec in [`docs/mvp/`](docs/mvp/00-overview.md):
[00 Overview](docs/mvp/00-overview.md) ·
[01 Contracts](docs/mvp/01-contracts.md) ·
[02 Data](docs/mvp/02-data.md) ·
[03 Buyer agent](docs/mvp/03-buyer-agent.md) ·
[04 Matching](docs/mvp/04-matching.md) ·
[05 Negotiation](docs/mvp/05-negotiation.md) ·
[06 UI](docs/mvp/06-ui.md) ·
[07 Managing data](docs/mvp/07-managing-data.md) ·
[08 Deploy](docs/mvp/08-deploy.md)

Coding agents: read [AGENTS.md](AGENTS.md) first.
