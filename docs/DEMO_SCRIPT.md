# ReturnGuard — 3-Minute Demo Script (screen recording + voiceover)

Two browser windows **side by side**: LEFT = customer page (`https://zz3ntem9.insforge.site/`), RIGHT = admin dashboard (`https://zz3ntem9.insforge.site/ops.html`). Record the screen; read the **VOICE** lines over it in your own voice. Customer lines are spoken into the mic during the live call.

## Pre-flight
- **Reset demo state** so tickets build up live on camera (keeps one pending ticket for the admin beat):
  `DELETE FROM cases WHERE order_id IN ('1234','5678');` (leave `4567` pending). Or keep all three as "history."
- **Three photos ready on your desktop:**
  1. **Fraud** — a slick blue Converse product photo saved from the web (e.g. `images.journeys.com/images/products/1_224909_FS.JPG`).
  2. **Used** — sneakers worn on feet (e.g. the Unsplash "converse on feet" shot).
  3. **Honest** — a *casual* phone photo of a handbag (real background — NOT a clean catalog shot, or vision may flag it as stock).
- The order number you **type** for upload must match the one you **say** on the call.
- **Bulletproof catch = the worn-item one** (deterministic DENY). The stock/resale one is great but Lens varies run-to-run — do one dry run right before filming; if it only *escalates*, re-take or lead with the worn catch.

---

## SCRIPT

**[0:00–0:08] HOOK** · ON SCREEN: admin dashboard — the red DENY ticket + "Fraud loss prevented" KPI in view.
> **VOICE:** "Return fraud costs online stores over a hundred billion dollars a year — because every returns bot just trusts the customer's photo. I built one that doesn't. Watch it catch someone, live."

**[0:08–0:20] SETUP** · ON SCREEN: switch to the storefront, scroll, click **"Talk to our returns concierge,"** allow mic.
> **VOICE:** "This is my boutique, Pearl of the Atlantic. There's no returns form — the customer just calls and talks to my AI concierge. The voice runs on **Vapi**."

**[0:20–1:10] CATCH #1 — FRAUD (live call, split screen)** · Enter order **5678**, upload the **slick Converse stock photo**, start the call.
> **YOU (mic):** "Hi — order five-six-seven-eight. My sneakers arrived damaged, I'd like a refund."
> **AGENT:** "Of course — let me verify that against your order and check the photo, this'll just take a few seconds." *(filler + ambient sound covers the wait)*
> **VOICE (over the pause):** "Behind that pause it's reverse-image-searching the photo with **Apify**, and running it through a **Nebius** vision model."
> **AGENT:** "I've looked into this — the photo you sent appears in online retail listings and doesn't match the item on your order, so I'm not able to approve this refund. You can reply to your confirmation email to appeal."
> ON SCREEN (RIGHT): ticket flips to **DENY**, score ~0.9, chips **"Found on resale · Apify"** + **"Stock image · Nebius"**, **"Fraud loss prevented"** climbs.
> **VOICE:** "Caught. That photo was never theirs — and seventy-five dollars just stayed in the business."

**[1:10–1:35] CATCH #2 — USED ITEM (bulletproof)** · New return, upload **worn-on-feet sneakers**.
> **YOU (mic):** "I'd like to return these sneakers — I changed my mind."
> **AGENT:** "I'm sorry, but this item's been worn, so it's not eligible for a refund under our policy."
> **VOICE:** "Different angle — a used item. The same **Nebius** vision sees it's been worn. That's not fraud, that's the store's return policy, enforced automatically."

**[1:35–2:00] HONEST — APPROVE** · Order **1234**, upload the **casual handbag photo**.
> **YOU (mic):** "Hi, order one-two-three-four — the strap on my handbag broke after a week."
> **AGENT:** "Good news — I've reviewed your return and your refund's approved. You'll see it back in three to five business days."
> ON SCREEN: ticket goes **green / approved**.
> **VOICE:** "And when it's genuine? Approved on the spot — no human, no waiting. Every decision is stored as a ticket on **InsForge**, which runs the entire backend."

**[2:00–2:35] ADMIN — HUMAN IN THE LOOP** · RIGHT window, **Needs review** tab → open the pending ticket (Marco · sweater) → show the drawer (customer + purchase, customer photo vs ordered product, signal chips, fraud score) → click **Approve**.
> **VOICE:** "And when it's genuinely borderline, the AI doesn't guess — it escalates. Every gray-area case lands in one queue, with the customer, the purchase, the photos and every signal already attached. My team decides in one click."

**[2:35–3:00] CLOSE** · ON SCREEN: dashboard wide — KPIs + the loss-prevented total.
> **VOICE:** "Voice from **Vapi**, vision from **Nebius**, live web checks from **Apify**, the whole backend on **InsForge**. One prevented fraudulent return pays for thousands of these calls. This is ReturnGuard — the returns line your store already has, that finally knows when it's being lied to."

---

## If it runs long, cut in this order
1. Drop CATCH #2 (used item). 2. Trim HONEST to one line. 3. Compress the admin walk-through to ticket → Approve.
**Never cut:** the fraud catch, the InsForge mention, or naming each sponsor on its feature.
