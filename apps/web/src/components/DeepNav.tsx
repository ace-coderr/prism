import { Link, useNavigate } from 'react-router-dom';
import type { Address } from 'viem';
import { backTarget, crystalHref, type Crumb } from '../data/nav';
import { profileHref } from '../data/share';

/**
 * Top-left of a deep page, under the navbar: "← Back" (to the previous PRISM page, or to
 * the Gallery for someone who arrived from a shared link) and a breadcrumb.
 */
export function DeepNav({ crumbs }: { crumbs: Crumb[] }) {
  const navigate = useNavigate();
  const back = () => {
    const to = backTarget(window.history.state);
    if (to === -1) navigate(-1);
    else navigate(to);
  };
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
      <button type="button" className="btn btn-outline shrink-0 !px-4 !py-2" onClick={back}>
        ← Back
      </button>
      <ol className="label flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-mist">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.to}-${i}`} className="flex min-w-0 items-center gap-2">
              {i > 0 && (
                <span aria-hidden className="text-white/25">
                  /
                </span>
              )}
              <Link
                to={c.to}
                aria-current={last ? 'page' : undefined}
                className={`truncate transition-colors hover:text-lime ${last ? 'text-white' : ''}`}
              >
                {c.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The links under a crystal's player or picture: the crystal, its owner, the Gallery. */
export function CrystalLinks({ id, owner, ownerName, viewer }: { id: bigint; owner: Address; ownerName?: string | null; viewer?: Address | null }) {
  const links = [
    { to: crystalHref(id, owner, viewer), label: `View crystal #${id}` },
    { to: profileHref(owner, ownerName), label: 'Owner’s profile' },
    { to: '/gallery', label: 'Gallery' },
  ];
  return (
    <nav aria-label={`More about crystal #${id}`}>
      {/* phones: the row wraps, so no dots (a line would start with one) */}
      <ul className="label flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:gap-x-3">
        {links.map((l, i) => (
          <li key={l.label} className="flex items-center gap-3">
            {i > 0 && (
              <span aria-hidden className="hidden text-white/25 sm:inline">
                ·
              </span>
            )}
            <Link to={l.to} className="text-lime hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The end of a crystal's page, for anyone who doesn't own it: make one. */
export function ForgeCta({
  title = 'A stock basket you can hold.',
  text = 'Pick a few test stocks and forge them into a crystal of your own, in one transaction from ETH.',
  button = 'Forge your own crystal',
}: {
  title?: string;
  text?: string;
  button?: string;
}) {
  return (
    <section className="card flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
      <div className="min-w-0">
        <p className="font-display text-2xl font-bold tracking-[-0.02em]">{title}</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-mist">{text}</p>
      </div>
      <Link to="/forge" className="btn btn-primary btn-lg shrink-0">
        {button}
      </Link>
    </section>
  );
}
