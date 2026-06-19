import { createClient } from 'npm:@insforge/sdk';

// Admin action: resolve a ticket (approve/deny). Used by the returns-ops dashboard
// to action escalated tickets — or override any case.
export default async function (req: Request): Promise<Response> {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const body = await req.json().catch(() => ({}));
    const id = String(body.id ?? '').trim();
    const decision = String(body.decision ?? '').trim();        // 'approved' | 'denied'
    const admin = String(body.admin ?? 'Store Admin').trim();
    const note = body.note ? String(body.note) : null;

    if (!id) return json({ error: 'id is required' }, 400);
    if (decision !== 'approved' && decision !== 'denied') return json({ error: "decision must be 'approved' or 'denied'" }, 400);

    const client = createClient({
        baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
        anonKey: Deno.env.get('ANON_KEY'),
    });

    const { data, error } = await client.database
        .from('cases')
        .update({
            status: 'resolved',
            final_decision: decision,
            resolved_by: admin,
            resolved_at: new Date().toISOString(),
            admin_note: note,
        })
        .eq('id', id)
        .select();

    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: 'case not found' }, 404);
    return json({ ok: true, case: data[0] });
}
