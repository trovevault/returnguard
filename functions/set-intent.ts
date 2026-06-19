import { createClient } from 'npm:@insforge/sdk';

// Records the order_id + reason the customer entered on the returns page when a call
// starts. The web form is the source of truth, so verify-return uses these values
// rather than re-deriving them from the live voice transcript.
export default async function (req: Request): Promise<Response> {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const body = await req.json().catch(() => ({}));
    const order_id = String(body.order_id ?? '').trim();
    const reason = body.reason ? String(body.reason) : null;

    const client = createClient({
        baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
        anonKey: Deno.env.get('ANON_KEY'),
    });
    await client.database.from('demo_intent').delete().eq('id', 'current');
    await client.database.from('demo_intent').insert([{ id: 'current', order_id, reason, updated_at: new Date().toISOString() }]);

    return new Response(JSON.stringify({ ok: true, order_id, reason }), {
        status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    });
}
