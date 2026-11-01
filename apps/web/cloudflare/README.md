# PRISM on Cloudflare Pages (free plan)

```
the scheduled job (GitHub Actions)              Cloudflare Pages                       the visitor's browser
──────────────────────────────────              ─────────────────────────────          ──────────────────────────────
reads the launch index, the reviews   ──►       static files: the app, /data/…  ──►    reads the files it needs, and
and the chain, runs the server's                 (free, unlimited)                      reads the chain for what is
own code once, writes /data/…                    + a tiny edge function for            live: a token's market, X-ray,
and the share cards, deploys                       /t, /r, /badge and share cards      setup; pictures from IPFS
```

Nothing is worked out when a request arrives. That is the whole design, and it is why the site fits:
Cloudflare's free plan gives a request **10 ms of CPU and 128 MB** (checked against its docs, updated
29 Oct 2026) and the old server needed seconds and 160 MB just to load the launch index.

## A. CPU per route: before, and where each one went

Measured on the real 258,000-launch index (Node 24; Cloudflare's CPUs are similar, not faster).

| route (old) | CPU per request | fits 10 ms? | now |
|---|---|---|---|
| `/api/feed`, `/leaderboards`, `/stocks`, `/token`, `/review`, `/reviewer`, `/badge` | **7.9 s cold** (the index 6.7 s + the reviews 1.2 s), 0.06–0.22 s warm | no | worked out by the job; saved as `/data/*.json`. The browser fetches a file |
| `/api/launches?q=` (search) | 210 ms per new query (scans 257k launches) | no | 1,200 search files, one per first two letters (median 2 KB, largest 225 KB), searched in the browser |
| `/api/launches?token=` (lookup) | 4.4 s cold (needs the index) | no | 256 launch files by address; the browser reads the one it needs (~96 KB) |
| `/api/meta` (picture, description, links) | 14 ms from cache; a first read is an IPFS fetch + hash check | no | 256 metadata files; a miss is read by the browser |
| `/api/market` | 63–78 ms + RPC | no | the browser, from the public RPC |
| `/api/xray` | 220–1,200 ms for a first read | no | the browser (1 s for $PRISM), same code |
| `/img/t/…` (picture) | 25 ms resize + IPFS fetch | no | the browser: gateway race, CID check, shrink |
| `/api/og/…` (share card) | 294 ms (SVG → PNG) | no | drawn by the job for reviewed tokens, $PRISM and every review; others get the site's card |
| `/t/…`, `/r/…` share tags | needed the token API above | no | the edge function (below) |

What runs on Cloudflare per request, measured the same way on the job's real output:

| edge route | per request | notes |
|---|---|---|
| share tags, $PRISM or a reviewed token | **1.3 ms** | one small file |
| share tags, any other launch | **2.1 ms** | finds its row in a 190 KB file by text search, parsing 1 row of 1,000 |
| share tags, a review | **1.2 ms** | |
| badge SVG | **0.6–2.1 ms** | |
| a share card | **0.9 ms** | a file the job drew |
| the app for a person, an old `/api` path | **0.1 ms** | |

`edge.test.ts` fails if any of these goes over 10 ms on the real files.

**Routes that cannot fit and were removed:** the old server API (`/api/feed`, `/api/token`, …). They
now answer `404`. The data is public under `/data/…` (the same JSON) for anyone who used it.

## B. Bringing `seeprism.xyz` back: the fastest safe order

Vercel is switched off (`402 DEPLOYMENT_DISABLED`), so **the site is already down and a cutover
can't make it worse**. `https://seeprism.pages.dev` is already serving the whole site with live data
(verified: every page, route and data file). Order, fastest first:

1. **Now, 2 minutes: let the job keep it fresh.** GitHub → repo → Settings → Secrets and variables →
   Actions → add `CLOUDFLARE_ACCOUNT_ID` (shown by `npx wrangler whoami`) and `CLOUDFLARE_API_TOKEN`
   (Cloudflare → My Profile → API Tokens → Create → "Edit Cloudflare Workers" template, scope it to this
   account; paste it only into GitHub's secret box). Then Actions → **Site data** → Run workflow once.
   Without them the site still works, but its files stay as of the last manual deploy.
2. **Privy:** add `https://seeprism.pages.dev` to the app's allowed origins in the Privy dashboard so
   you can test wallet login there (`https://seeprism.xyz` is already allowed). Log in, post nothing,
   check the connect button and the review form open.
3. **Add the domain to Cloudflare** (dash.cloudflare.com → Add a domain → `seeprism.xyz` → Free). It
   imports the DNS records it finds: keep `MX`/`TXT` (email, verification), and ignore the
   `A 76.76.21.21` / `CNAME cname.vercel-dns.com` ones (Vercel's; step 5 replaces them).
4. **At your registrar, change the nameservers** to the two Cloudflare shows (`xxx.ns.cloudflare.com`).
   Wait for the domain to read **Active** (minutes to a few hours). The site is down during this wait
   whatever you do, so nothing is lost by starting it first.
5. **Workers & Pages → seeprism → Custom domains → Set up a custom domain** → `seeprism.xyz`, then
   `www.seeprism.xyz`. Cloudflare creates the DNS record and the certificate. Add a Redirect Rule
   `www` → apex.
6. **SSL/TLS** → **Full (strict)**. **Security → Bots → Bot Fight Mode** on. Add the rate-limit rule in C.
7. **Check:** `https://seeprism.xyz` loads with data; `curl -A Twitterbot https://seeprism.xyz/t/0x56C3…DaCF`
   returns a `<title>` of `$PRISM …`; a badge URL returns SVG.
8. **Later:** remove `seeprism.xyz` from the Vercel project; keep or delete the project (it is no
   longer used).

**Roll back:** Cloudflare → DNS → apex `A 76.76.21.21` and `www` `CNAME cname.vercel-dns.com`
(**DNS only**), once Vercel is running again; or set the registrar's nameservers back.

**Don't change DNS until you've approved this.** Nothing has been changed.

## C. What a bot can hit repeatedly, and what stops it

| a bot requests | what it costs | limit |
|---|---|---|
| `/`, `/assets/*`, `/data/*`, any app path | nothing: static files are free and unlimited | cached (`_headers`: 2–10 min; assets for a year) |
| `/t/<address>`, `/r/<id>` as a link-preview crawler | one function run, 1–2 ms, **counts toward 100,000/day** | only a valid address / number reaches a lookup (anything else is the static app); a made response is kept 5 min per URL in the data centre's cache |
| `/t/…`, `/r/…` as anyone else | one function run, 0.1 ms, counts toward the 100,000 | same |
| `/badge/<address>.svg` | one run, 0.6–2.1 ms, counts | valid address only; cached 5 min; unknown token → 404 (cached 60 s) |
| `/api/…` (the old API) | one run, 0.1 ms, counts | answers a tiny `404`, cached 5 min |
| the app's data in a browser a bot drives | reads our static files (free) and **the public RPC from the bot's own address** | not ours: the RPC's own limits; a bot can't use our CPU |

The one real risk is the 100,000/day count (not CPU, not money): a bot walking 100,000 different valid
addresses a day would use it all, and the rest of that day's share links and badges would fail until
midnight UTC. After the domain is on Cloudflare: **Security → WAF → Rate limiting rules** (one rule is
free): `URI Path` starts with `/t/` or `/r/` or `/badge/` → 60 requests per 10 seconds per IP → block
for 10 minutes. Bot Fight Mode (free) stops the commonest scrapers before they reach the function.
`pages.dev` can't take these rules, which is another reason to use the real domain.

## Free plan limits, against this site

| limit | value | this site |
|---|---|---|
| function requests | 100,000 a day | only `/t`, `/r`, `/badge`, share cards and `/api` 404s: about 1 per token or review page view; Home, Leaderboards, Stocks and search use **none** |
| CPU / memory per request | 10 ms / 128 MB | 0.1–2.1 ms; the data files are ≤ 0.5 MB |
| files per site, per file | 20,000 / 25 MiB | 1,982; the largest is 0.5 MB |
| Pages deployments | 500 builds a month for Git builds (a direct upload isn't one) | one every 2 hours = 360 a month either way |

## What changed for visitors (the honest list)

- **Reviews and boards** are rewritten every 2 hours for other people (GitHub's scheduler can run late:
  this repo's hourly job has run 2–7 hours apart). The person who posts a review sees it at once: the page
  reads the review contract itself right after posting.
- **A token's market, X-ray and setup** are read by the visitor's browser from the public RPC (a second
  or two). If the RPC is down they say so; the files still load.
- **Search** finds a launch by the start of its symbol or of any word in its name: all graduated
  launches, all reviewed ones and the newest 60,000 (75,000 in all). Older ones are found by address.
  A word nearly every launch shares ("vibe") keeps its newest 2,500. One letter finds only a one-letter symbol.
- **Pictures** come from IPFS gateways, raced, checked against the token's on-chain CID and shrunk in
  the visitor's browser (it used to be on the server). The first view is slower; if no gateway answers
  it is the identicon.
- **Share cards** are drawn for the tokens with reviews, $PRISM and every review. Any other link preview
  shows the site's card, with the right title.
- **The old `/api/*` JSON is gone** (see A).

## Files

| | |
|---|---|
| `../scripts/build-site-data.ts` | the job: runs the server's own code once, writes `data/` (launch, search and metadata files, the feed, every review, the cards) |
| `../scripts/cloudflare-output.mjs` | assembles `site/`: the app, `data/`, `_routes.json`, `_headers` |
| `edge.ts`, `functions/[[path]].ts` | the edge function (tested in `test/edge.test.ts`) |
| `../src/data/site.ts` | what the pages read: the files, the browser's live reads |
| `../src/data/live.ts`, `local/*` | the server's market, X-ray, metadata and review code, run in the browser (`vite.config.ts` swaps its four Node-only modules for `local/*` in the client build only) |
| `../../.github/workflows/site-data.yml` | builds and deploys every 2 hours |
| `package.json`, `wrangler.toml` | make this folder wrangler's project root, and name the project |

Deploy by hand: `npx wrangler login` once, then `npm run build:site-data -w @prism/web && npm run build -w @prism/web && npm run deploy:cloudflare -w @prism/web`.
Wrangler 4.156 sends Pages commands through Cloudflare Workers by default, and that path rewrote this repo's
Vite config and lockfile during testing. The project was created with `--force` (the direct Pages path);
if a future wrangler offers to "auto-configure" it, decline.
