# ReturnGuard Reverse Image Check

Minimal reverse image search Actor for the **ReturnGuard** returns-fraud voice agent.

Give it a customer's product photo URL; it asks **SerpApi Google Lens** where that image appears online and flags any matches on **resale marketplaces** (eBay, Mercari, Poshmark, etc.). A resale match is a strong return-fraud signal: the customer is reselling the item they want refunded, or grabbed a listing's stock photo to fake damage.

## Input

| field | required | description |
|---|---|---|
| `imageUrl` | yes | Publicly fetchable URL of the customer's photo. |
| `serpApiKey` | yes* | SerpApi key. Can also be supplied via the `SERPAPI_KEY` env var. |
| `resaleDomains` | no | Domains that count as a fraud signal (sensible defaults included). |
| `maxResults` | no | Max matches to return (default 20). |

\* Mark as a **secret** input on the Apify platform.

## Output

One dataset item (also written to the `OUTPUT` key-value record):

```json
{
  "imageUrl": "...",
  "totalMatches": 14,
  "matches": [{ "title": "...", "link": "...", "domain": "ebay.com", "source": "eBay", "image": "...", "price": "$199" }],
  "resaleMatches": [ ... ],
  "resaleMatchCount": 2,
  "resaleDomainsHit": ["ebay.com", "mercari.com"],
  "fraudSignal": true,
  "error": null
}
```

The ReturnGuard decision engine reads `resaleMatchCount` / `resaleDomainsHit` for the resale flag, and `matches[].image` gives the real listing image to hand to the vision compare.

## Notes

- Built for a demo — single image per run, no OCR, no pagination.
- SerpApi must be able to fetch the image URL. Some hosts (e.g. Wikimedia) are not fetchable; serve the customer photo from your own public URL.
- Errors (bad key, quota, no results) return `totalMatches: 0` and exit cleanly rather than failing the run.
