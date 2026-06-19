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
    resaleFlag: boolean;
    resaleDomains: string[];
    variantMatch: boolean | null;   // null = vision not run yet
    damageGenuine: boolean | null;
    orderId: string;
}): { verdict: Verdict; fraudScore: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    if (signals.resaleFlag) {
        score += 0.55;
        reasons.push(`Exact image found listed for resale on ${signals.resaleDomains.join(', ') || 'a marketplace'}`);
    }
    if (signals.variantMatch === false) {
        score += 0.35;
        reasons.push('Photo does not match the ordered product/variant');
    } else if (signals.variantMatch === true) {
        score -= 0.15;
        reasons.push('Photo matches the variant on the order');
    }
    // Damage only counts as a risk signal when the customer cited damage AND there
    // is already another fraud indicator — avoids flagging "no visible damage" on honest returns.
    if (signals.damageGenuine === false && signals.resaleFlag) {
        score += 0.10;
        reasons.push('Reported damage does not look genuine');
    }

    score = Math.max(0, Math.min(1, score));
    const verdict: Verdict = score > 0.6 ? 'deny' : score >= 0.3 ? 'escalate' : 'auto_approve';

    // Clean, non-contradictory messaging on approvals.
    if (verdict === 'auto_approve') {
        return { verdict, fraudScore: Number(score.toFixed(2)), reasons: ['Photo matches the order; no resale or product mismatch found'] };
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

// Nebius vision — compares the customer photo to the reference (official/listing)
// image. Returns null fields until NEBIUS_API_KEY is set or if either image is missing.
async function visionCompare(customerUrl: string, referenceUrl: string | null) {
    const key = Deno.env.get('NEBIUS_API_KEY');
    if (!key || !referenceUrl) return { variantMatch: null, damageGenuine: null };

    const [refData, custData] = await Promise.all([toDataUrl(referenceUrl), toDataUrl(customerUrl)]);
    if (!refData || !custData) return { variantMatch: null, damageGenuine: null };

    try {
        const res = await fetch('https://api.tokenfactory.nebius.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model: 'Qwen/Qwen2.5-VL-72B-Instruct',
                response_format: { type: 'json_object' },
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Image A is the official product the customer ordered. Image B is the customer photo of what they received. Return strict JSON {"same_variant":bool,"damage_looks_genuine":bool,"confidence":0-1}. same_variant is false if the color/model/product differs.' },
                        { type: 'image_url', image_url: { url: refData } },
                        { type: 'image_url', image_url: { url: custData } },
                    ],
                }],
                signal: AbortSignal.timeout(25000),
            }),
        });
        const data = await res.json();
        const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
        return {
            variantMatch: typeof parsed.same_variant === 'boolean' ? parsed.same_variant : null,
            damageGenuine: typeof parsed.damage_looks_genuine === 'boolean' ? parsed.damage_looks_genuine : null,
        };
    } catch {
        return { variantMatch: null, damageGenuine: null };
    }
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
    const orderId = String(args.order_id ?? '').trim();
    const reason = String(args.reason ?? '').trim();
    const toolCallId = toolCall?.id ?? null;

    const client = createClient({
        baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
        anonKey: Deno.env.get('ANON_KEY'),
    });

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

    // 3. Nebius vision (variant / damage). Reference = the ordered product image
    //    (true "wrong variant" detection), falling back to the Lens listing image.
    const referenceImage = orderedImage ?? listingImage;
    const vision = photoUrl ? await visionCompare(photoUrl, referenceImage) : { variantMatch: null, damageGenuine: null };

    // 4. Fuse → verdict.
    const { verdict, fraudScore, reasons } = decide({
        resaleFlag, resaleDomains,
        variantMatch: vision.variantMatch, damageGenuine: vision.damageGenuine,
        orderId,
    });

    // 5. Persist the case.
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
    };
    const { data: inserted } = await client.database.from('cases').insert([caseRow]).select();

    // 6. Speak the verdict.
    return respond(speak(verdict, orderId, reasons), inserted?.[0] ?? caseRow);
}
