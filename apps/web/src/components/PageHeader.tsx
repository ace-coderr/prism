import type { ReactNode } from 'react';
import { Headline, Reveal, SectionLabel } from './design';

/**
 * Every page opens the same way: a mono label, a big headline with one lime phrase,
 * and one plain sentence saying what the page is for (plus optional extras).
 */
export function PageHeader({
  label,
  lead,
  accent,
  subtitle,
  children,
}: {
  label: string;
  lead: string;
  accent?: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <SectionLabel>{label}</SectionLabel>
        <Headline as="h1" size="display-md" lead={lead} accent={accent} className="mt-5" />
        <Reveal delay={0.15}>
          <p className="body-copy mt-5">{subtitle}</p>
        </Reveal>
      </div>
      {children && <div className="flex flex-wrap items-center gap-3 md:pb-2">{children}</div>}
    </header>
  );
}

/** A page's content column: max 1200px, clear of the floating navbar, generous gaps. */
export function PageScroll({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`container-x flex flex-col gap-14 pb-28 pt-32 md:gap-20 md:pb-40 md:pt-44 ${className}`}>{children}</div>;
}
