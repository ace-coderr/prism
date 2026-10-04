import type { ReactNode } from 'react';
import { Headline, Reveal, SectionLabel } from './design';

/**
 * Every page opens the same way: a mono label, a big headline with one lime phrase,
 * one plain sentence saying what the page is for, then (optionally) the page's one
 * GuideNote, always in the same slot directly under the header.
 */
export function PageHeader({
  label,
  lead,
  accent,
  subtitle,
  guide,
  children,
}: {
  label: string;
  lead: string;
  accent?: string;
  subtitle: string;
  guide?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header>
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <SectionLabel>{label}</SectionLabel>
          <Headline as="h1" size="display-md" lead={lead} accent={accent} className="mt-5" />
          <Reveal delay={0.15}>
            <p className="body-copy mt-5">{subtitle}</p>
          </Reveal>
        </div>
        {children && <div className="flex flex-wrap items-center gap-3 md:pb-2">{children}</div>}
      </div>
      {guide && <div className="mt-8">{guide}</div>}
    </header>
  );
}

/** A page's content column: max 1200px, clear of the floating navbar. */
export function PageScroll({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`container-x flex flex-col gap-12 pb-20 pt-28 md:gap-16 md:pb-28 md:pt-36 ${className}`}>{children}</div>;
}
