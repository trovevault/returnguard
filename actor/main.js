import { Actor } from 'apify';

await Actor.init();

const DEFAULT_RESALE_DOMAINS = [
    'ebay.com', 'mercari.com', 'poshmark.com', 'facebook.com',
    'depop.com', 'offerup.com', 'aliexpress.com', 'etsy.com',
    'goat.com', 'stockx.com', 'grailed.com', 'vinted.com', 'vestiairecollective.com',
];

const input = (await Actor.getInput()) ?? {};
const {
    imageUrl,
    serpApiKey = process.env.SERPAPI_KEY,
    resaleDomains = DEFAULT_RESALE_DOMAINS,
    maxResults = 20,
} = input;

// Always emit a result object and exit cleanly, even on error, so the voice
// flow degrades to "no resale evidence" instead of crashing the call.
async function emit(result) {
    await Actor.pushData(result);
    await Actor.setValue('OUTPUT', result);
    await Actor.exit();
}

const base = {
    imageUrl: imageUrl ?? null,
    totalMatches: 0,
    matches: [],
    resaleMatches: [],
    resaleMatchCount: 0,
    resaleDomainsHit: [],
    fraudSignal: false,
    error: null,
};

if (!imageUrl) {
    await emit({ ...base, error: 'imageUrl is required' });
}
if (!serpApiKey) {
    await emit({ ...base, error: 'serpApiKey (or SERPAPI_KEY env var) is required' });
}

const domainOf = (link) => {
    try { return new URL(link).hostname.replace(/^www\./, ''); }
    catch { return null; }
};
const inResale = (domain) =>
    !!domain && resaleDomains.some((d) => domain === d || domain.endsWith(`.${d}`));

let data;
try {
    const params = new URLSearchParams({ engine: 'google_lens', url: imageUrl, api_key: serpApiKey });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
        signal: AbortSignal.timeout(20000),
    });
    data = await res.json();
} catch (err) {
    await emit({ ...base, error: `SerpApi request failed: ${err.message}` });
}

const vmRaw = Array.isArray(data.visual_matches) ? data.visual_matches : [];
const matches = vmRaw.slice(0, maxResults).map((m) => ({
    title: m.title ?? null,
    link: m.link ?? null,
    domain: domainOf(m.link),
    source: m.source ?? null,
    thumbnail: m.thumbnail ?? null,
    image: m.image ?? null,          // full-res match image — feed to the vision compare
    price: m.price?.value ?? null,   // SerpApi returns price as an object
}));

const resaleMatches = matches.filter((m) => inResale(m.domain));
const resaleDomainsHit = [...new Set(resaleMatches.map((m) => m.domain))];

await emit({
    imageUrl,
    totalMatches: matches.length,
    matches,
    resaleMatches,
    resaleMatchCount: resaleMatches.length,
    resaleDomainsHit,
    fraudSignal: resaleMatches.length > 0,
    // SerpApi reports "no results" as an error string even on HTTP 200 — surface it but don't fail.
    error: data.error ?? null,
});
