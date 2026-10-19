import { Link, useSearchParams } from 'react-router-dom';
import { tokenPath } from '@prism/core';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { SearchBar } from '../components/SearchBar';
import { SearchRow } from '../components/SearchRow';
import { GuideNote } from '../components/Viber';
import { useSearch, useXrayFlags } from '../data/api';

/** /search?q=…: every match (up to 50), with pictures, market details and PRISM's reviews. */
export default function Search() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const search = useSearch(q, 50);
  const items = search.data?.items ?? [];
  const flags = useXrayFlags(items.map((a) => a.token));
  return (
    <PageScroll>
      <PageHeader label="Search" lead="Find a" accent="launch." subtitle="Every vibe/vibe launch and test stock, by name, $SYMBOL or address." />
      <div className="max-w-[720px]">
        <SearchBar key={q} size="md" initial={q} />
      </div>
      {!q ? (
        <GuideNote index={0}>Type a name, a $SYMBOL or paste an address above.</GuideNote>
      ) : search.isError ? (
        <GuideNote index={2}>Search isn’t available right now. Try again in a minute.</GuideNote>
      ) : search.isLoading ? (
        <p className="text-sm text-mist">Searching…</p>
      ) : items.length === 0 ? (
        <GuideNote index={2}>Nothing matches “{q}”. A brand-new launch shows up within a minute; a full address always opens its page.</GuideNote>
      ) : (
        <section aria-label={`Results for ${q}`} className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mist">
            {items.length === 50 ? 'Top 50 matches' : `${items.length} match${items.length === 1 ? '' : 'es'}`} for “{q}”
          </p>
          <ul className="flex flex-col gap-2">
            {items.map((a) => (
              <li key={a.token}>
                <Link to={tokenPath(a.token)} className="card card-hover flex px-4 py-3">
                  <SearchRow a={a} size="lg" flag={flags[a.token.toLowerCase()]} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageScroll>
  );
}
