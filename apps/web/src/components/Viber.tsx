import { useState, type ReactNode } from 'react';
import { viberAt, viberImageUrl, type OfficialViber } from '@prism/core';

/*
 * vibe vibers are featured with vibe/vibe's permission (credit in README.md): official
 * images only, shown as-is. Their server sends CORP same-origin, so every image is
 * requested in CORS mode (crossOrigin="anonymous"), which it allows.
 *
 * Vibers appear in one place only: a GuideNote, directly under a page or section header.
 */

/** An official viber image, displayed as-is. */
export function ViberImage({
  viber,
  size = 72,
  eager = false,
  className = '',
}: {
  viber: OfficialViber;
  size?: number;
  eager?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`inline-block shrink-0 bg-white/5 ${className}`} style={{ width: size, height: size }} aria-hidden />;
  return (
    <img
      src={viberImageUrl(viber.file)}
      crossOrigin="anonymous"
      alt={viber.description}
      width={size}
      height={size}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={`shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

/**
 * The one way vibers appear: the viber (72px, rounded square) on the left, a speech
 * bubble on the right, at most 560px wide. One per page section, directly under its
 * header. `action` puts buttons inside the bubble.
 */
export function GuideNote({ index, children, action, className = '' }: { index: number; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex w-full max-w-[560px] items-start gap-4 ${className}`}>
      <ViberImage viber={viberAt(index)} size={72} eager className="rounded-2xl bg-panel" />
      <div className="relative min-w-0 flex-1 rounded-2xl rounded-tl-md border border-white/10 bg-panel px-5 py-4 text-[15px] leading-relaxed text-white/90">
        {children}
        {action && <div className="mt-4 flex flex-wrap items-center gap-3">{action}</div>}
      </div>
    </div>
  );
}
