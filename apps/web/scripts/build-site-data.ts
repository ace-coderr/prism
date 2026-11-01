/**
 * Writes the site's data as static files (read-only: the chain's public RPC and the published
 * launch index; no keys):
 *
 *   npx tsx scripts/build-site-data.ts <out-dir>
 *
 * The site is hosted where one request gets 10 ms of CPU and 128 MB, so nothing that needs the whole
 * launch index or every review runs at request time. This runs the server's own code once, here, and
 * saves what it answers:
 *
 *   info.json                when it was read, up to which block, how many launches
 *   feed.json, leaderboards.json, stocks.json, scores.json
 *   token/<address>.json     every reviewed token and the test stocks (reviews, score, paired launches)
 *   review/<id>.json         every review      reviewer/<address>.json   every reviewer
 *   l/<xx>.json              the launch index in 256 files by the first two hex digits of the token
 *   s/<ab>.json              search: launches filed under the first two letters of their symbol and name words
 *   m/<xx>.json              verified metadata (picture, description, links) in the same 256 files
 *   flags.json               the one-line X-ray flags of the launches whose creator is watched
 *   og/t/<address>.png, og/r/<id>.png   the share cards, drawn here (a request can't spare the CPU)
 *
 * The browser reads these, and does the per-token reads (market, X-ray, setup) itself from the RPC.
 * LAUNCH_INDEX_FILE, LAUNCH_META_FILE and LAUNCH_XRAY_FILE (local .json.gz files) replace the downloads.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { META_CACHE_URL, PRISM_TOKEN, SEARCH_SPLIT_OVER, decodeMetaCache, tokenScore, launchRow, launchShardKey, searchKey3Of, searchKeyOf, searchKeysFor, searchWordsOf, type LaunchShardRow, type ReviewableAsset } from '@prism/core';

const out = resolve(process.argv[2] ?? 'site-data');
/** How many of the newest launches are findable by name; every graduated and every reviewed one is too. */
const SEARCHABLE_NEWEST = 60_000;

const { currentIndex } = await import('../server/launchIndex');
const { reviewState } = await import('../server/reviewState');
const { default: handler } = await import('../server/data');
const { cachedFlags } = await import('../server/xray');

rmSync(out, { recursive: true, force: true });
const put = (path: string, body: unknown) => {
  const file = join(out, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
};

/** One of the server's own routes, answered in-process. */
async function call(path: string): Promise<any> {
  let body = '';
  const res = { statusCode: 0, setHeader() {}, end(b?: string) { body = b ?? ''; } };
  await handler({ url: path, method: 'GET', headers: {}, socket: {} } as never, res as never);
  if (res.statusCode !== 200) throw new Error(`${path} → ${res.statusCode} ${body.slice(0, 120)}`);
  return JSON.parse(body);
}

console.log('reading the launch index and the reviews…');
const idx = await currentIndex();
const s = await reviewState();
const launches = idx.index.launches;
console.log(`${launches.length.toLocaleString()} launches to block ${idx.index.toBlock}, reviews read at block ${s.block}${idx.stale ? ' (the index is stale)' : ''}`);

// ---- who is reviewed
const views = s.world.views.filter((v) => v.listed);
const reviewedTokens = [...new Set(views.map((v) => v.token.toLowerCase()))];
const rowOf = (l: (typeof launches)[number]): LaunchShardRow => launchRow(l, idx.assetByToken.get(l.token.toLowerCase()) as ReviewableAsset);

// ---- launches, in 256 files
const shards = new Map<string, LaunchShardRow[]>();
for (const l of launches) {
  const k = launchShardKey(l.token);
  (shards.get(k) ?? shards.set(k, []).get(k)!).push(rowOf(l));
}
for (const [k, rows] of shards) put(`l/${k}.json`, rows);

// ---- search, filed by the first two letters of each word
const wanted = new Set<string>(reviewedTokens);
for (const l of launches.slice(-SEARCHABLE_NEWEST)) wanted.add(l.token.toLowerCase());
for (const l of launches) if (l.graduatedBlock !== null) wanted.add(l.token.toLowerCase());
const search = new Map<string, LaunchShardRow[]>();
for (const l of launches) {
  if (!wanted.has(l.token.toLowerCase())) continue;
  const row = rowOf(l);
  for (const k of searchKeysFor(l.symbol, l.name)) (search.get(k) ?? search.set(k, []).get(k)!).push(row);
}
let splitFiles = 0;
for (const [k, rows] of search) {
  if (rows.length <= SEARCH_SPLIT_OVER) {
    put(`s/${k}.json`, rows);
    continue;
  }
  // too many for one download: file them by their first three letters, and leave the newest here
  const sub = new Map<string, LaunchShardRow[]>();
  for (const row of rows) {
    for (const w of searchWordsOf(row[2], row[1])) {
      if (searchKeyOf(w) !== k || w.length < 3) continue;
      const list = sub.get(searchKey3Of(w)) ?? sub.set(searchKey3Of(w), []).get(searchKey3Of(w))!;
      if (list.at(-1) !== row) list.push(row);
    }
  }
  // a word nearly every launch shares ("vibe") can't be split further: keep its newest
  for (const [k3, list] of sub) put(`s/${k3}.json`, list.slice(-SEARCH_SPLIT_OVER));
  put(`s/${k}.json`, { split: true, top: rows.slice(-300).reverse() });
  splitFiles++;
}

// ---- verified metadata, in the same 256 files
const metaGz = process.env.LAUNCH_META_FILE ? readFileSync(process.env.LAUNCH_META_FILE) : Buffer.from(await (await fetch(META_CACHE_URL, { redirect: 'follow' })).arrayBuffer());
const meta = decodeMetaCache(JSON.parse(gunzipSync(metaGz).toString('utf8')));
const metaShards = new Map<string, unknown[]>();
if (meta) for (const row of meta.rows.values()) (metaShards.get(launchShardKey(row[0])) ?? metaShards.set(launchShardKey(row[0]), []).get(launchShardKey(row[0]))!).push(row);
for (const [k, rows] of metaShards) put(`m/${k}.json`, rows);

// ---- the creator watch's flags
const { ready: watchRead, flags } = await cachedFlags(launches.map((l) => l.token));
if (!watchRead) console.warn('the creator watch could not be read: flags.json is empty this time');
put('flags.json', flags);
const watched = Object.keys(flags);

// ---- what the server answers, saved
console.log('saving the pages’ data…');
const feed = await call('/api/feed');
put('feed.json', feed);
put('leaderboards.json', await call('/api/leaderboards'));
put('stocks.json', await call('/api/stocks'));

const stocks = idx.assets.filter((a) => a.kind === 'stock').map((a) => a.token.toLowerCase());
// $PRISM is on the list whether or not anyone has reviewed it: its page is the one people are sent to
const featured = PRISM_TOKEN ? [PRISM_TOKEN.toLowerCase()] : [];
for (const t of [...new Set([...reviewedTokens, ...stocks, ...featured])]) put(`token/${t}.json`, await call(`/api/token?address=${t}`));
for (const v of views) put(`review/${v.id}.json`, await call(`/api/review?id=${v.id}`));
for (const a of new Set(views.map((v) => v.author.toLowerCase()))) put(`reviewer/${a}.json`, await call(`/api/reviewer?address=${a}`));

// the number of reviews and the score next to each reviewed token in search results
const scores: Record<string, { reviews: number; score: unknown }> = {};
for (const t of reviewedTokens) {
  const reviews = views.filter((v) => v.token.toLowerCase() === t && !v.retired && v.status !== 'replaced').length;
  const body = JSON.parse(readFileSync(join(out, `token/${t}.json`), 'utf8'));
  scores[t] = { reviews, score: reviews ? body.score : null };
}
put('scores.json', scores);

put('info.json', {
  builtAt: Math.floor(Date.now() / 1000),
  indexBlock: idx.index.toBlock,
  indexGeneratedAt: idx.index.generatedAt,
  launches: launches.length,
  reviewsBlock: Number(s.block),
  stale: idx.stale,
  // what a token nobody has reviewed scores (none yet)
  emptyScore: tokenScore(s.world, '0x0000000000000000000000000000000000000001', s.balances),
  // the reviewed tokens' launches: what a live read of the reviews needs, with no file to fetch first
  reviewed: reviewedTokens.flatMap((t) => (idx.launchByToken.has(t) ? [rowOf(idx.launchByToken.get(t)!)] : [])),
});

// ---- share cards, for the tokens and reviews people are most likely to link to
console.log('drawing share cards…');
const { launchCardSvg, reviewCardSvg } = await import('../server/svg');
const { renderPng } = await import('../server/render');
const putPng = async (path: string, svg: string) => {
  const file = join(out, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, await renderPng(svg));
};
let cards = 0;
for (const t of new Set([...reviewedTokens, ...featured])) {
  const tok = JSON.parse(readFileSync(join(out, `token/${t}.json`), 'utf8'));
  // what the chain says about the launch, so a shared link carries it (a read this long is fine here)
  let lines: string[] = [];
  for (let i = 0; i < 12 && tok.asset.kind === 'launch'; i++) {
    const x = await call(`/api/xray?token=${t}`).catch(() => null);
    if (x?.ready) {
      lines = (x.xray?.signals ?? []).filter((sg: { id: string }) => sg.id === 'creator' || sg.id === 'concentration').map((sg: { text: string }) => sg.text);
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const market = tok.asset.kind === 'launch' ? await call(`/api/market?token=${t}`).catch(() => null) : null;
  await putPng(
    `og/t/${t}.png`,
    launchCardSvg({
      token: tok.asset.token,
      symbol: tok.asset.symbol,
      name: tok.asset.name,
      pair: tok.asset.quote?.symbol ?? 'ETH',
      status: tok.asset.kind === 'stock' ? null : market ? (market.status === 'graduated' ? 'graduated' : 'curve') : tok.asset.status,
      progress: market?.progress ?? tok.setup?.progress ?? null,
      score: tok.score,
      xray: lines,
    }),
  );
  cards++;
}
for (const v of views) {
  const r = (await call(`/api/review?id=${v.id}`)).review;
  await putPng(`og/r/${v.id}.png`, reviewCardSvg({ id: r.id, author: r.author, name: null, symbol: r.symbol, rating: r.rating, text: r.text, state: r.state, days: r.days }));
  cards++;
}

console.log(
  `done → ${out}: ${shards.size} launch files, ${search.size} search files (${splitFiles} split in three-letter files) (${wanted.size.toLocaleString()} launches findable by name), ${metaShards.size} metadata files, ` +
    `${reviewedTokens.length} reviewed tokens, ${views.length} reviews, ${watched.length} flags, ${cards} share cards`,
);
