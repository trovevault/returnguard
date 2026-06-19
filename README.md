# ReturnGuard 🛡️

**A voice agent for e-commerce returns that checks the live web mid-call to catch return fraud — before issuing a refund.**

Built for the Midsummer Multimodal AI Hackathon. Demo storefront: **Pearl of the Atlantic Boutique**.

Return fraud costs e-commerce over $100B a year. Every AI returns bot trusts the customer's photo. ReturnGuard doesn't — while the customer is still on the call, it reverse-image-searches their photo across the web, compares it to the product they actually ordered, and checks resale marketplaces. Then it decides, out loud, whether to **approve the refund**, **place it under review**, or **decline** it.

## The multimodal trifecta

| Modality | Provider | Role |
|---|---|---|
| 🎙️ Voice | **Vapi** | The returns concierge — talks to the customer, calls the `verifyReturn` tool |
| 👁️ Vision | **Nebius** (Qwen2.5-VL-72B) | Compares the customer's photo to the ordered product — same item? right variant? genuine damage? |
| 🌐 Live web | **Apify** | Reverse-image-searches the photo (Google Lens via SerpApi) to flag items relisted on resale marketplaces |
| 🗄️ Backend | **InsForge** | Postgres + edge functions + storage — the entire orchestrator, no separate server |

## How it works

```
 Customer (web)                InsForge edge functions                 External
 ─────────────                ────────────────────────                ────────
 web/index.html  ── photo ──▶ upload-photo ──▶ storage bucket
      │                                              │
      │  voice call (Vapi web SDK)                   │
      ▼                                              ▼
   Vapi assistant ── verifyReturn ─────▶ verify-return ──┬─▶ Apify Actor (reverse image search)
   (reads verdict back, warmly)                          ├─▶ Nebius Qwen2.5-VL (photo vs ordered product)
                                                         └─▶ decision engine ─▶ cases table
                                                                                     │
 web/ops.html  ◀── live poll (cases-feed) ───────────────────────────────────────────┘
 (returns ops dashboard)
```

**Decision engine** (`functions/verify-return.ts`) fuses the signals into a fraud score:

- `+0.55` photo found listed on a resale marketplace (Apify)
- `+0.35` photo doesn't match the ordered product/variant (Nebius vision)
- `−0.15` photo matches the ordered variant
- `+0.10` reported damage doesn't look genuine (only counts alongside a resale hit)

→ `< 0.30` **auto-approve** · `0.30–0.60` **escalate (under review)** · `> 0.60` **deny**

The voice agent reads back the matching outcome verbatim and a ticket is written to `cases` — which lights up the ops dashboard in real time.

## Repo structure

```
returnguard/
├── actor/          Apify Actor — reverse image search via SerpApi Google Lens
│   ├── main.js     returns { fraudSignal, resaleDomainsHit, matches[] }
│   └── .actor/     input schema + actor config
├── functions/      InsForge edge functions (Deno)
│   ├── upload-photo.ts   store customer photo, link to order
│   ├── verify-return.ts  Vapi tool webhook + decision engine
│   └── cases-feed.ts     public read-only feed for the dashboard
├── web/
│   ├── index.html  customer storefront + voice concierge + ticket outcome
│   └── ops.html    business ops dashboard (live fraud decisions)
├── db/schema.sql   cases / uploads / orders tables
└── .env.example    required keys
```

## Setup

1. **Apify Actor** — `cd actor && apify push`. Note the actor slug.
2. **InsForge** — `npx @insforge/cli link --project-id <id>`, then:
   - `insforge db query "$(cat db/schema.sql)"`
   - `insforge storage create-bucket return-photos --public`
   - `insforge secrets add NEBIUS_API_KEY <key>` (and `APIFY_TOKEN`, `SERPAPI_KEY`)
   - `insforge functions deploy <slug> --file functions/<slug>.ts` (×3)
3. **Vapi** — create an assistant with a `verifyReturn` function tool whose `server.url` points at the deployed `verify-return` function. Put the **public** key in `web/index.html` and the assistant id alongside it.
4. **Web** — `insforge deployments deploy web`.

See `.env.example` for every key. Secrets live in InsForge / your env — **never commit them**.

## Tech

Vapi · Apify · Nebius Token Factory · InsForge · SerpApi (Google Lens) · Deno · vanilla JS

> ⚠️ The Vapi **public** key in `web/index.html` is publishable by design (client-side). All private keys are read from environment / InsForge secrets and are never committed.
