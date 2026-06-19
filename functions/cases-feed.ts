import { createClient } from 'npm:@insforge/sdk';

// Public, read-only feed of the latest ReturnGuard decision tickets, enriched with
// the customer + purchase details from the orders table. Backs the ops dashboard.
export default async function (req: Request): Promise<Response> {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const client = createClient({
        baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
        anonKey: Deno.env.get('ANON_KEY'),
    });

    const { data: cases, error } = await client.database
        .from('cases')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

    const { data: orders } = await client.database.from('orders').select('*');
    const byOrder: Record<string, Record<string, unknown>> = {};
    for (const o of orders ?? []) byOrder[o.order_id] = o;

    const enriched = (cases ?? []).map((c: Record<string, unknown>) => {
        const o = byOrder[c.order_id as string] ?? {};
        return {
            ...c,
            customer_name: o.customer_name ?? null,
            customer_email: o.customer_email ?? null,
            product_name: o.product_name ?? null,
            price: o.price ?? null,
            currency: o.currency ?? 'USD',
            order_date: o.order_date ?? null,
            payment_last4: o.payment_last4 ?? null,
            ordered_image_url: o.product_image_url ?? null,
        };
    });

    return new Response(
        JSON.stringify({ data: enriched, error: error?.message ?? null }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
}
