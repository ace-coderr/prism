import type { ReactNode } from 'react';

/** Every page: a title, one plain sentence saying what the page is for, optional extras. */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="headline text-3xl">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-mist">{subtitle}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A page's scroll area: the scrollbar sits at the window edge, the content is centred. */
export function PageScroll({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={`mx-auto flex flex-col p-4 ${className}`}>{children}</div>
    </div>
  );
}
