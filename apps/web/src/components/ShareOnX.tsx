import { xIntent } from '../data/share';

export { SHARE, profileLink } from '../data/share';

export function XLogo({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.42 4.7H5.6l11.07 14.5Z" />
    </svg>
  );
}

/** "Share on X": opens X's composer in a new tab with `text` ready to post. */
export function ShareOnX({
  text,
  label = 'Share on X',
  className = 'btn btn-outline',
  onClick,
}: {
  text: string;
  label?: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a href={xIntent(text)} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>
      <XLogo />
      {label}
    </a>
  );
}
