import { createClient } from 'npm:@insforge/sdk';

// Receives a customer return photo (multipart: order_id + file), stores it in the
// public `return-photos` bucket, records the photo↔order link, and returns the
// public URL that Apify Lens + Nebius vision will fetch.
export default async function (req: Request): Promise<Response> {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    // Storage writes need the privileged project key, not the anon role.
    const client = createClient({
        baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
        anonKey: Deno.env.get('API_KEY') ?? Deno.env.get('ANON_KEY'),
    });

    // JSON body: { order_id, imageBase64 (raw or data: URL), contentType? }
    const body = await req.json().catch(() => ({}));
    const orderId = String(body.order_id ?? '').trim();
    let b64 = String(body.imageBase64 ?? '');
    if (!orderId) return json({ error: 'order_id is required' }, 400);
    if (!b64) return json({ error: 'imageBase64 is required' }, 400);

    // Accept "data:image/jpeg;base64,..." or a bare base64 string.
    let contentType = String(body.contentType ?? '');
    const m = b64.match(/^data:([^;]+);base64,(.*)$/s);
    if (m) { contentType = contentType || m[1]; b64 = m[2]; }
    contentType = contentType || 'image/jpeg';

    let bytes: Uint8Array;
    try {
        const bin = atob(b64);
        bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
        return json({ error: 'imageBase64 is not valid base64' }, 400);
    }

    const ext = (contentType.split('/')[1] || 'jpg').toLowerCase();
    const path = `orders/${orderId}-${Date.now()}.${ext}`;
    const file = new File([bytes], `${orderId}.${ext}`, { type: contentType });

    const { data: up, error: upErr } = await client.storage.from('return-photos').upload(path, file);
    if (upErr || !up?.url) return json({ error: `upload failed: ${upErr?.message ?? 'unknown'}` }, 500);

    // One photo per order: replace any prior link.
    await client.database.from('uploads').delete().eq('order_id', orderId);
    const { error: insErr } = await client.database
        .from('uploads')
        .insert([{ order_id: orderId, photo_url: up.url, photo_key: up.key }]);
    if (insErr) return json({ error: `record failed: ${insErr.message}` }, 500);

    return json({ order_id: orderId, photo_url: up.url });
}
