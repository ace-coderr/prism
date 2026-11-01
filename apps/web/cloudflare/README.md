# PRISM on Cloudflare Pages

The app is a static single-page site plus a few data routes. This folder is the Cloudflare half:
the static app, and a small edge function in front of the data routes.

```
visitor ──► Cloudflare Pages ──► static app, images' redirect, 404s           (free, unlimited)
                │
                └─► edge function (/api, /badge, /t, /r)  ──► data routes at the origin (Vercel)
                     · caches what the origin answers
                     · gives link-preview crawlers the share-ready page, people the app
                     · never forwards a path the site doesn't have
                     · tells the origin who the visitor is, so its limits count visitors, not Cloudflare
```

## What runs where, and why

Cloudflare's free plan (checked against the docs, updated 29 Oct 2026):

| | Workers Free (Pages Functions share it) | What the data routes need |
|---|---|---|
| Requests | 100,000 a day. Static files don't count | n/a |
| **CPU per request** | **10 ms** | 25 ms to resize a picture, 300 ms for a share card, **about 4,400 ms to load the launch index** |
| **Memory** | **128 MB** | about 160 MB for the 257,000-launch index alone |
| Subrequests | 50 | fine |
| Files per site, size per file | 20,000, 25 MiB | fine |

The data routes can't run inside those limits. So they stay where they are (Vercel), and Cloudflare
serves everything that can be served without them. Moving them too would mean replacing the server
with pre-computed snapshots; see "Moving everything" below, because it has costs.

**This is what makes the site cheap to run, not Cloudflare.** The CPU the site was using was the
server redoing work it had already done (commit `b870e4e`): on the real index a refresh went from
about 5 s of CPU to 0.1–0.25 s, and the index refresh alone from 1.9–3 s to 16–47 ms. Cloudflare in
front serves the static app, the biggest part of the traffic, and answers repeats from its cache.

## The request budget

Every call to the edge function counts toward 100,000 a day (a cache hit too: the function runs
either way). Static files, and the token pictures (a static redirect to the origin, which holds them
for a year), don't.

| a visitor opens | function runs |
|---|---|
| Home | about 3 (feed, the $PRISM X-ray, a search or two) |
| a token page | about 6–8 (the page route, token, metadata, market, X-ray and its follow-up reads) |
| Leaderboards, Stocks, a review | 1–3 |

At about 5 runs a page, the free plan covers **roughly 15,000–20,000 page views a day**. That is
a measurement to make, not an assumption: after cutover, look at Workers & Pages → seeprism →
Metrics for a few days. If a day goes over, the rest of that day's data requests fail until
midnight UTC; Workers Paid ($5 a month) lifts the cap.

## Files

| | |
|---|---|
| `edge.ts` | what the edge does with a request, as plain functions (tested in `test/edge.test.ts`). Uses the same route table as the Vercel build (`../server/routes.json`) |
| `functions/[[path]].ts` | the Pages Function: a thin wrapper around `edge.ts` and the edge cache |
| `../scripts/cloudflare-output.mjs` | assembles `site/`: the app, `_routes.json`, `_redirects`, `_headers` |
| `wrangler.toml` | project name and `ORIGIN_URL` (where the data routes run) |
| `package.json` | makes this folder wrangler's project root, so it finds `functions/` here |

## Deploying

```bash
npm run build                          # the app, as for Vercel
npm run deploy:cloudflare -w @prism/web   # assembles site/, then `wrangler pages deploy`
```

You need to be logged in once (`npx wrangler login`, which opens a browser). A deploy goes to
`https://seeprism.pages.dev` (and a preview address per deploy); the custom domain below is what
makes it the live site.

Wrangler 4.156 now sends Pages commands through Cloudflare Workers by default, and that path rewrote
this repo's Vite config and lockfile during testing. The project was created with `--force` (the
direct Pages path), which is only needed once; after that, commands run against Pages directly.
If a future wrangler asks to "auto-configure" the project, decline: nothing here needs it.

## Before the domain moves

1. **The origin has to be running.** On 1 Nov 2026 Vercel returned `402 DEPLOYMENT_DISABLED` for the
   whole project (its monthly function-CPU allowance was used up), so every data route fails, on
   `seeprism.xyz` today and behind this edge just the same. Check the project's Usage page for when
   it resets, or raise the plan. The fixes in `b870e4e` only take effect once it deploys.
2. **Privy:** add `https://seeprism.pages.dev` (for testing) to the app's allowed origins in the Privy
   dashboard, or wallet login fails there. `https://seeprism.xyz` is already allowed.
3. **Visitor addresses.** Pick a long random string and set it as `EDGE_KEY` in both places:
   Cloudflare Pages → seeprism → Settings → Variables and Secrets (encrypt it), and Vercel →
   Settings → Environment Variables (then redeploy). Without it the origin sees every visitor as one
   Cloudflare address and its per-client limits (24 searches a minute and so on) would be shared by
   everyone.

## Moving `seeprism.xyz` (do not do this until you approve)

Nothing here has been changed yet. `seeprism.xyz` still points at Vercel.

1. **Cloudflare → Add a domain** → `seeprism.xyz` → Free plan. Cloudflare imports the DNS records it
   finds. Check them: keep any `MX` and `TXT` records (email, verification); the `A 76.76.21.21` and
   `CNAME cname.vercel-dns.com` records for the apex and `www` are Vercel's and are replaced in step 4.
2. **At your registrar**, change the nameservers to the two Cloudflare shows you (`xxx.ns.cloudflare.com`).
   Until Cloudflare reports the domain **Active** (minutes to a few hours), the site keeps working
   as before.
3. **Workers & Pages → seeprism → Custom domains → Set up a custom domain** → `seeprism.xyz`.
   Cloudflare adds the DNS record (a proxied CNAME at the apex) and the certificate itself. Add
   `www.seeprism.xyz` the same way, then a **Redirect Rule** from `www` to the apex.
4. If the old Vercel records are still in the DNS tab, delete them (Cloudflare will have asked).
5. **SSL/TLS** → mode **Full (strict)** (what Pages uses).
6. Check: `https://seeprism.xyz/` loads; `https://seeprism.xyz/api/feed` is JSON; a response header
   `x-prism-edge: hit` appears on the second request; a Twitterbot user-agent request to a `/t/0x…`
   page returns a page whose `<title>` is the token's.
7. After a day, remove `seeprism.xyz` from the Vercel project's Domains (the origin stays reachable
   at `seeprism.vercel.app`, which is what `ORIGIN_URL` points at).

**Rolling back:** Cloudflare → DNS → change the apex record to `A 76.76.21.21` and the `www`
record to `CNAME cname.vercel-dns.com`, both **DNS only** (grey cloud). Or point the registrar's
nameservers back to where they were. Vercel keeps serving as it did.

## Moving everything (the option this does not take)

To leave Vercel entirely on the free plan, the server would be replaced by files built by the
scheduled job and read in the browser:

- the index sharded by address and by name prefix into static files (the 24 MB file can't be loaded
  in 128 MB, and a search can't scan 257,000 rows in 10 ms);
- the feed, leaderboards, stocks, scores and reviews computed by the job and published, with the
  token page's live reads (market, setup, X-ray) done by the browser straight from the RPC;
- share cards pre-drawn for the tokens that have reviews, and one generic card for the rest; token
  pictures loaded from an IPFS gateway directly.

The costs: a review would appear when the job next publishes (GitHub's scheduler ran this one at
intervals of 2–7 hours, not hourly) unless the browser also reads reviews live; a link preview for an
arbitrary launch shows the generic card; pictures are no longer verified against their hash or
resized by PRISM. It is a rewrite of the data layer (days of work, not an afternoon), and a product
decision rather than a hosting one, so it is not started.
