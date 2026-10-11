import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAddress, isAddress, type Address } from 'viem';
import { BADGES, atName, explorerAddressUrl, xUrl, type BadgeId } from '@prism/core';
import { DeepNav } from '../components/DeepNav';
import { useProfileEditor } from '../components/editorContext';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { ReviewList } from '../components/reviews';
import { SHARE, ShareOnX, XLogo, profileLink } from '../components/ShareOnX';
import { SectionLabel } from '../components/design';
import { GuideNote } from '../components/Viber';
import { useReviewer } from '../data/api';
import { plural, repText } from '../data/format';
import { profileCrumbs } from '../data/nav';
import { Avatar, profileHref, profilesContract, shortAddress, useAddressOfName, useProfile, type Profile } from '../data/profiles';
import { WalletButton, useWallet } from '../wallet/WalletButton';

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** /profile (yours) and /u/:name or /u/:address (anyone's, shareable). */
export default function ProfilePage() {
  const { id } = useParams();
  const { address: me } = useWallet();
  if (!id) {
    if (!me) return <NotConnected />;
    return <ProfileView key={me} address={me} />;
  }
  if (isAddress(id)) return <ProfileView key={id} address={getAddress(id)} deep />;
  return <ByName name={id.toLowerCase()} />;
}

function NotConnected() {
  return (
    <PageScroll>
      <PageHeader
        label="Profile"
        lead="Your"
        accent="profile."
        subtitle="Your honesty rep, badges and reviews, with a page you can share."
        guide={
          <GuideNote index={3} action={<WalletButton variant="hero" />}>
            Log in or connect a wallet to see your profile.
          </GuideNote>
        }
      />
    </PageScroll>
  );
}

function ByName({ name }: { name: string }) {
  const lookup = useAddressOfName(name);
  if (lookup.data) return <ProfileView key={lookup.data} address={lookup.data} deep />;
  const note = !profilesContract()
    ? 'Usernames turn on once the profiles contract is deployed. Until then, profiles are at /u/ followed by an address.'
    : lookup.isLoading
      ? 'Looking up the name…'
      : lookup.isError
        ? 'Couldn’t look that name up right now. Try again in a moment.'
        : `Nobody has ${atName(name)} yet.`;
  return (
    <PageScroll>
      <div className="flex flex-col gap-8 md:gap-10">
        <DeepNav crumbs={profileCrumbs(atName(name), `/u/${name}`)} />
        <PageHeader label="Profile" lead={atName(name)} subtitle="A PRISM profile." guide={<GuideNote index={3}>{note}</GuideNote>} />
      </div>
    </PageScroll>
  );
}

/** `deep`: opened at /u/… (often from a shared link), so it gets "← Back" and a breadcrumb. */
function ProfileView({ address, deep = false }: { address: Address; deep?: boolean }) {
  const { address: me } = useWallet();
  const mine = same(me, address);
  const { profile } = useProfile(address);
  const label = profile.name ? atName(profile.name) : shortAddress(address);
  return (
    <PageScroll>
      <div className="flex flex-col gap-8 md:gap-10">
        {deep && <DeepNav crumbs={profileCrumbs(label, profileHref(address, profile.name))} />}
        <ProfileHeader address={address} profile={profile} mine={mine} />
      </div>
      <ReviewerStats address={address} label={label} mine={mine} />
    </PageScroll>
  );
}

const BADGE_ICON: Record<BadgeId, string> = { 'first-review': '✎', 'truth-keeper': '⚖', 'held-30': '⏳', 'early-reviewer': '✦' };

function ReviewerStats({ address, label, mine }: { address: Address; label: string; mine: boolean }) {
  const q = useReviewer(address);
  if (q.isError) return <GuideNote index={2}>Couldn’t load reviews right now. Try again in a minute.</GuideNote>;
  if (!q.data) return <p className="text-mist">Reading the chain…</p>;
  const s = q.data.summary;
  const stats: Array<[string, string, string?]> = [
    ['Reviews', String(s?.reviews ?? 0)],
    ['Holding', String(s?.holding ?? 0), 'text-lime'],
    ['Trimmed', String(s?.trimmed ?? 0), 'text-gold'],
    ['SOLD', String(s?.sold ?? 0), 'text-down'],
  ];
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="card p-6 md:p-8">
          <p className="section-label">Honesty rep</p>
          <p className="mt-2 font-display text-7xl font-bold tracking-[-0.05em] text-lime md:text-8xl">{repText(s?.rep)}</p>
          <p className="mt-3 text-[14px] leading-relaxed text-mist">
            {s && s.decided > 0
              ? `Kept holding at least 7 days after reviewing in ${s.kept} of ${plural(s.decided, 'position')}.`
              : 'The share of reviews where they kept holding at least 7 days afterwards. It shows once a review is a week old (or sold).'}
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(([k, v, tone]) => (
              <div key={k} className="card p-4">
                <dt className="section-label text-[10px]">{k}</dt>
                <dd className={`mt-1 font-display text-3xl font-bold ${tone ?? 'text-white'}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Badges">
            {(Object.keys(BADGES) as BadgeId[]).map((b) => {
              const earned = !!s?.badges.includes(b);
              return (
                <li key={b} className={`card flex items-center gap-3 p-4 ${earned ? '' : 'opacity-45'}`}>
                  <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl ${earned ? 'bg-lime/15 text-lime' : 'bg-white/5 text-mist'}`}>
                    {BADGE_ICON[b]}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display font-bold text-white">
                      {BADGES[b].title}
                      {!earned && <span className="sr-only"> (not earned yet)</span>}
                    </span>
                    <span className="block text-[12px] leading-snug text-mist">{BADGES[b].how}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <section className="flex flex-col gap-5">
        <SectionLabel>{mine ? 'Your reviews' : `${label}’s reviews`}</SectionLabel>
        <ReviewList
          reviews={q.data.reviews}
          showToken
          empty={
            <GuideNote index={1} action={mine ? <Link to="/" className="btn btn-primary">Find a token you hold</Link> : undefined}>
              {mine ? 'No reviews yet. Search a launch you hold and review it: your honesty rep grows when you keep holding what you review.' : `${label} hasn’t reviewed anything yet.`}
            </GuideNote>
          }
        />
      </section>
    </>
  );
}

function ProfileHeader({ address, profile, mine }: { address: Address; profile: Profile; mine: boolean }) {
  const editor = useProfileEditor();
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}${profileHref(address, profile.name)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
      <Avatar address={address} size={112} className="rounded-[28px]" />
      <div className="min-w-0">
        <SectionLabel>{mine ? 'Your profile' : 'Profile'}</SectionLabel>
        <h1 className="display-md mt-4 break-words">{profile.name ? atName(profile.name) : shortAddress(address)}</h1>
        <a href={explorerAddressUrl(address)} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all font-mono text-[11px] text-mist hover:text-lime" title="View on explorer">
          {address} ↗
        </a>
        {profile.bio && <p className="body-copy mt-5 break-words">{profile.bio}</p>}
        {profile.x && (
          <a
            href={xUrl(profile.x)}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-5 flex w-fit items-center gap-1.5 text-sm text-white hover:text-lime"
            title="Unverified: anyone can set any handle"
          >
            <XLogo size={14} />@{profile.x}
            <span className="text-[11px] text-mist">(unverified)</span>
          </a>
        )}
        <div className="mt-7 flex flex-wrap gap-3">
          {mine && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!editor.available}
              title={editor.available ? undefined : 'Profiles turn on once their contract is deployed'}
              onClick={editor.open}
            >
              Edit profile
            </button>
          )}
          {mine && <ShareOnX text={SHARE.profile(profileLink(address, profile.name))} />}
          <button type="button" className="btn btn-outline" onClick={share}>
            {copied ? 'Link copied ✓' : mine ? 'Copy link' : 'Share profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
