import { createClient } from 'npm:@insforge/sdk';

// Public, read-only feed of the latest ReturnGuard decision cases.
// Backs the company ops dashboard so the project key never touches the browser.
export default async function (req: Request): Promise<Response> {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
    }

    const client = createClient({
        baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
        anonKey: Deno.env.get('ANON_KEY'),
    });

    const { data, error } = await client.database
        .from('cases')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25);

    return new Response(
        JSON.stringify({ data: data ?? [], error: error?.message ?? null }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
}
