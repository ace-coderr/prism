import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAddress } from 'viem';
import { tokenPath } from '@prism/core';
import { useSearch, type SearchItem } from '../data/api';
import { SearchRow } from './SearchRow';

/** Debounced value: the search waits until typing pauses. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * The big search: name, symbol or address. Results open the token's page; a full address opens
 * its page directly (Enter), so a launch that isn't indexed yet still has a way in.
 */
export function SearchBar({ autoFocus = false, size = 'lg', initial = '' }: { autoFocus?: boolean; size?: 'lg' | 'md'; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q, 200);
  const search = useSearch(debounced);
  const navigate = useNavigate();
  const listId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const items = debounced.trim() ? (search.data?.items ?? []) : [];

  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  useEffect(() => setActive(0), [debounced]);

  const go = (a: SearchItem) => {
    setOpen(false);
    setQ('');
    navigate(tokenPath(a.token));
  };
  const submit = () => {
    const pick = items[active];
    if (pick) go(pick);
    else if (isAddress(q.trim(), { strict: false })) {
      setOpen(false);
      navigate(tokenPath(q.trim()));
    } else if (q.trim()) all();
  };
  const all = () => {
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div ref={ref} className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`flex items-center gap-3 rounded-2xl border border-white/15 bg-panel px-4 transition focus-within:border-lime/70 ${size === 'lg' ? 'h-16' : 'h-12'}`}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden className="shrink-0 text-mist" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m13 13 4 4" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(0, items.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Escape') setOpen(false);
          }}
          autoFocus={autoFocus}
          placeholder="Search a launch: name, $SYMBOL or 0x address"
          aria-label="Search launches and test stocks by name, symbol or address"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className={`w-full min-w-0 bg-transparent outline-none placeholder:text-mist/70 ${size === 'lg' ? 'text-[17px]' : 'text-[15px]'}`}
        />
        {search.isFetching && <span className="font-mono text-[11px] text-mist">…</span>}
      </form>
      {open && debounced.trim() && (
        <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]">
          {search.isError ? (
            <p className="px-4 py-3 text-sm text-mist">Search isn’t available right now. Try again in a minute.</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-mist">
              {search.isFetching ? 'Searching…' : isAddress(debounced.trim(), { strict: false }) ? 'Not indexed yet. Press Enter to open it anyway.' : 'No launch or test stock matches that.'}
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Results">
              {items.map((a, i) => (
                <li key={a.token} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(a)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${i === active ? 'bg-white/5' : ''}`}
                  >
                    <SearchRow a={a} />
                  </button>
                </li>
              ))}
              <li className="border-t border-white/[0.06]">
                <button type="button" onClick={all} className="w-full px-4 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-mist hover:text-white">
                  All results for “{debounced.trim()}” →
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
