import { Link, useNavigate } from 'react-router-dom';
import { backTarget, type Crumb } from '../data/nav';

/**
 * Top-left of a deep page, under the navbar: "← Back" (to the previous PRISM page, or to
 * Home for someone who arrived from a shared link) and a breadcrumb.
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
