import { createClient } from 'npm:@insforge/sdk';

// ReturnGuard decision engine. Invoked as a Vapi custom-tool webhook (or directly
// with { order_id, reason } for testing). Fuses three signals into a verdict:
//   - resale_flag        (Apify reverse-image: customer photo found on a resale marketplace)
//   - variant mismatch   (Nebius vision: customer photo vs the real listing image)  [pending key]
//   - review corroboration (reserved; lowers fraud for genuine common defects)
// Writes the case to InsForge and returns a spoken verdict for the agent.

const APIFY_ACTOR = 'luis.pinto~returnguard-reverse-image-check';

type Verdict = 'auto_approve' | 'escalate' | 'deny';

function decide(signals: {
    photoProvided: boolean;
    looksLikeStock: boolean | null;  // vision: catalog/stock image vs the customer's own snapshot
    appearsUsed: boolean | null;     // vision: signs of prior use/wear
    beingWorn: boolean | null;       // vision: item is currently being worn
    resaleFlag: boolean;
    resaleDomains: string[];
    variantMatch: boolean | null;    // null = no reference image to compare against
    damageGenuine: boolean | null;
}): { verdict: Verdict; fraudScore: number; reasons: string[] } {
    // Can't verify a return without a photo of the item — never auto-approve blind.
    if (!signals.photoProvided) {
        return { verdict: 'escalate', fraudScore: 0.5, reasons: ['No photo of the item was provided, so the return needs manual review'] };
    }

    let score = 0;
    const reasons: string[] = [];

    // Eligibility layer: worn/used items are not returnable. "Being worn" is a hard
    // policy block (decisive deny); general wear is a softer contributing signal.
    if (signals.beingWorn === true) {
        score += 0.9;
        reasons.push('The item is shown being worn — used items are not eligible for a refund under our returns policy');
    }
    if (signals.appearsUsed === true) {
        score += 0.25;
        reasons.push('The item shows clear signs of use and wear');
    }

    if (signals.looksLikeStock === true) {
        score += 0.45;
        reasons.push('Uploaded image looks like a stock/online product photo, not a photo of the actual item received');
    }
    if (signals.resaleFlag) {
        score += 0.45;
        reasons.push(`This image was found in online listings (${signals.resaleDomains.join(', ') || 'a marketplace'})`);
    }
    if (signals.variantMatch === false) {
        score += 0.35;
        reasons.push('Photo does not match the ordered product/variant');
    } else if (signals.variantMatch === true) {
        score -= 0.15;
        reasons.push('Photo matches the ordered product');
    }
    // Damage only counts as a risk signal alongside another indicator —
    // avoids flagging "no visible damage" on honest returns.
    if (signals.damageGenuine === false && (signals.resaleFlag || signals.looksLikeStock === true)) {
        score += 0.10;
        reasons.push('Reported damage does not look genuine');
    }

    score = Math.max(0, Math.min(1, score));
    const verdict: Verdict = score > 0.6 ? 'deny' : score >= 0.3 ? 'escalate' : 'auto_approve';

    if (verdict === 'auto_approve') {
        return { verdict, fraudScore: Number(score.toFixed(2)), reasons: ['Photo appears to be a genuine photo of the item, matching the order with no resale match'] };
    }
    return { verdict, fraudScore: Number(score.toFixed(2)), reasons };
}

function speak(verdict: Verdict, orderId: string, reasons: string[]): string {
    const why = (reasons[0] ?? '').toLowerCase();
    if (verdict === 'auto_approve') {
        // Approved on the spot — tell them the refund is happening.
        return `Good news — I've reviewed your return for order ${orderId} and your refund has been approved. You'll see it back on your original payment method within three to five business days. Is there anything else I can help with?`;
    }
    if (verdict === 'deny') {
        // Declined — clear, polite, with the reason and an appeal path.
        return `I've looked into your return for order ${orderId}, and I'm sorry but we're not able to approve this refund — ${why}. If you believe this is a mistake, you can reply to your confirmation email to appeal and a specialist will take another look.`;
    }
    // Needs a human — set the expectation that it's under review, not decided.
    return `Thanks for that. I've logged your return for order ${orderId}, and because it needs a closer look one of our specialists will review it and get back to you within twenty-four hours.`;
}

// Nebius requires image URLs with a real extension or a base64 data URL. Lens /
// storage URLs often lack a clean extension, so we always fetch + inline as base64.
async function toDataUrl(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        const ct = res.headers.get('content-type') || '';
        const mime = ct.startsWith('image/') ? ct : 'image/jpeg';
        return `data:${mime};base64,${btoa(bin)}`;
    } catch {
        return null;
    }
}

async function nebiusJSON(content: unknown[]): Promise<Record<string, unknown>> {
    const key = Deno.env.get('NEBIUS_API_KEY');
    if (!key) return {};
    try {
        const res = await fetch('https://api.tokenfactory.nebius.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model: 'Qwen/Qwen2.5-VL-72B-Instruct',
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content }],
                signal: AbortSignal.timeout(25000),
            }),
        });
        const data = await res.json();
        return JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    } catch {
        return {};
    }
}

const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

// Nebius vision. Two independent checks so each is deterministic:
//  - inspection of the CUSTOMER photo alone (stock vs real, used/worn, damage)
//  - variant comparison against the ordered product image (only if we have one)
// Keeping them separate stops a varying reference image from destabilizing the
// used/worn read of the customer's own photo.
async function analyzePhoto(customerUrl: string, referenceUrl: string | null) {
    const NULLS = { variantMatch: null, damageGenuine: null, looksLikeStock: null, appearsUsed: null, beingWorn: null };
    if (!Deno.env.get('NEBIUS_API_KEY')) return NULLS;

    const custData = await toDataUrl(customerUrl);
    if (!custData) return NULLS;

    const inspectPromise = nebiusJSON([
        { type: 'text', text: 'This is the photo a customer uploaded for a product return. Return strict JSON {"looks_like_stock_photo":bool,"appears_used":bool,"being_worn":bool,"damage_looks_genuine":bool}. being_worn=true if the item is currently on a person\'s body or feet (e.g. shoes on feet, clothing being worn). appears_used=true if the item shows clear signs of prior use or wear (scuffs, dirt, creasing, worn soles, stains). looks_like_stock_photo=true ONLY if this is clearly a professional catalog/marketing product photo (studio lighting, clean/white background) rather than a casual photo the customer took themselves.' },
        { type: 'image_url', image_url: { url: custData } },
    ]);

    const refData = referenceUrl ? await toDataUrl(referenceUrl) : null;
    const variantPromise = refData
        ? nebiusJSON([
            { type: 'text', text: 'Image A is the product the customer ordered. Image B is the photo the customer uploaded. Return strict JSON {"same_variant":bool}. same_variant=false if Image B is a different color, model or product than Image A.' },
            { type: 'image_url', image_url: { url: refData } },
            { type: 'image_url', image_url: { url: custData } },
        ])
        : Promise.resolve({} as Record<string, unknown>);

    const [insp, varr] = await Promise.all([inspectPromise, variantPromise]);
    return {
        looksLikeStock: asBool(insp.looks_like_stock_photo),
        appearsUsed: asBool(insp.appears_used),
        beingWorn: asBool(insp.being_worn),
        damageGenuine: asBool(insp.damage_looks_genuine),
        variantMatch: asBool(varr.same_variant),
    };
}

export default async function (req: Request): Promise<Response> {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const body = await req.json().catch(() => ({}));

    // Vapi custom-tool webhook shape vs. direct test call.
    const toolCall = body?.message?.toolCallList?.[0] ?? null;
    const args = toolCall?.function?.arguments ?? body;
    const toolCallId = toolCall?.id ?? null;

    const client = createClient({
        baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
        anonKey: Deno.env.get('ANON_KEY'),
    });

    // The returns web form is the source of truth for order_id + reason (recorded via
    // set-intent when the call starts); fall back to the values the agent passes.
    let orderId = String(args.order_id ?? '').trim();
    let reason = String(args.reason ?? '').trim();
    try {
        const { data: intent } = await client.database.from('demo_intent').select('*').eq('id', 'current').limit(1);
        if (intent?.[0]?.order_id) {
            orderId = String(intent[0].order_id).trim();
            reason = String(intent[0].reason ?? reason);
        }
    } catch { /* not in demo mode */ }

    const respond = (spoken: string, caseRow: unknown) => {
        const payload = toolCallId
            ? { results: [{ toolCallId, result: spoken }] }
            : { spoken, case: caseRow };
        return new Response(JSON.stringify(payload), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    };

    if (!orderId) return respond('I need an order number to look into this.', null);

    // 1. Look up the photo uploaded for this order + the ordered product reference image.
    const { data: up } = await client.database.from('uploads').select('photo_url').eq('order_id', orderId).limit(1);
    const photoUrl: string | null = up?.[0]?.photo_url ?? null;
    const { data: ord } = await client.database.from('orders').select('product_image_url').eq('order_id', orderId).limit(1);
    const orderedImage: string | null = ord?.[0]?.product_image_url ?? null;

    // 2. Apify reverse-image search (resale flag + real listing image).
    let resaleFlag = false, resaleDomains: string[] = [], listingImage: string | null = null;
    if (photoUrl) {
        try {
            const token = Deno.env.get('APIFY_TOKEN');
            const serp = Deno.env.get('SERPAPI_KEY');
            const r = await fetch(
                `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${token}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageUrl: photoUrl, serpApiKey: serp, maxResults: 20 }),
                    signal: AbortSignal.timeout(30000),
                },
            );
            const rows = await r.json();
            const out = Array.isArray(rows) ? rows[0] : rows;
            resaleFlag = !!out?.fraudSignal;
            resaleDomains = Array.isArray(out?.resaleDomainsHit) ? out.resaleDomainsHit : [];
            listingImage = out?.resaleMatches?.[0]?.image ?? out?.matches?.[0]?.image ?? null;
        } catch { /* degrade to no-evidence */ }
    }

    // 3. Nebius vision — always analyze the customer photo (stock vs real, damage);
    //    compare variant against the ordered product image when we have one.
    const referenceImage = orderedImage ?? listingImage;
    const vision = photoUrl
        ? await analyzePhoto(photoUrl, referenceImage)
        : { variantMatch: null, damageGenuine: null, looksLikeStock: null, appearsUsed: null, beingWorn: null };

    // 4. Fuse → verdict.
    const { verdict, fraudScore, reasons } = decide({
        photoProvided: !!photoUrl,
        looksLikeStock: vision.looksLikeStock,
        appearsUsed: vision.appearsUsed,
        beingWorn: vision.beingWorn,
        resaleFlag, resaleDomains,
        variantMatch: vision.variantMatch, damageGenuine: vision.damageGenuine,
    });

    // 5. Persist the case. Auto-decisions resolve immediately; escalations wait for an admin.
    const isEscalate = verdict === 'escalate';
    const caseRow = {
        order_id: orderId,
        reason: reason || null,
        verdict,
        fraud_score: fraudScore,
        variant_match: vision.variantMatch,
        resale_flag: resaleFlag,
        resale_domains: resaleDomains,
        reasons,
        photo_url: photoUrl,
        listing_url: listingImage,
        status: isEscalate ? 'pending' : 'resolved',
        final_decision: verdict === 'auto_approve' ? 'approved' : verdict === 'deny' ? 'denied' : null,
        resolved_by: isEscalate ? null : 'ReturnGuard AI',
        resolved_at: isEscalate ? null : new Date().toISOString(),
    };
    const { data: inserted } = await client.database.from('cases').insert([caseRow]).select();

    // 6. Speak the verdict.
    return respond(speak(verdict, orderId, reasons), inserted?.[0] ?? caseRow);
}
