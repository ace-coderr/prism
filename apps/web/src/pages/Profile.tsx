import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAddress, isAddress, type Address } from 'viem';
import {
  activityOf,
  atName,
  badgesOf,
  explorerAddressUrl,
  explorerTx,
  getDeployment,
  identicon,
  xUrl,
  type ActivityItem,
  type BadgeId,
  type CrystalHistory,
} from '@prism/core';
import { AssetDots } from '../components/AssetDots';
import { FittedCrystal } from '../components/Crystal';
import { CrystalThumb } from '../components/CrystalThumb';
import { useProfileEditor } from '../components/editorContext';
import { LoadingStage } from '../components/LoadingStage';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { SHARE, ShareOnX, profileLink } from '../components/ShareOnX';
import { SectionLabel } from '../components/design';
import { Stage } from '../components/Stage';
import { Change, formatEth } from '../components/ui';
import { GuideNote } from '../components/Viber';
import { timeAgo, useBlockTimes, useCrystalEvents } from '../data/activity';
import { useTestnetTokens, type LiveToken } from '../data/chain';
import { realCrystalHistory } from '../data/crystalHoldings';
import { earliestForge, useMyCrystals, type OnchainCrystal } from '../data/crystals';
import { valueCrystal, type MarketOf, type Valued } from '../data/crystalValue';
import { OwnerChip, profileHref, profilesContract, shortAddress, useAddressOfName, useProfile, useProfiles, type Profile } from '../data/profiles';
import { TARGET_CHAIN } from '../wallet/config';
import { WalletButton, useWallet } from '../wallet/WalletButton';

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Badge ids this browser has already shown for a wallet (null = never looked yet). */
const seenKey = (a: Address) => `prism.badges.seen.${a.toLowerCase()}`;
function readSeen(a: Address): string[] | null {
  try {
    const v = window.localStorage.getItem(seenKey(a));
    return v ? (JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}
function writeSeen(a: Address, ids: string[]) {
  try {
    window.localStorage.setItem(seenKey(a), JSON.stringify(ids));
  } catch {
    /* storage blocked: every badge just stays shareable from its card */
  }
}

/**
 * Badges earned since this browser last looked at the owner's profile. The first look only
 * records what is already earned (so old badges don't all pop up as new); a badge that
 * turns up after that is "new" until it is shared or dismissed.
 */
function useNewBadges(address: Address, earned: string[] | null, ready: boolean) {
  const [fresh, setFresh] = useState<string[]>([]);
  const key = earned?.join(',') ?? '';
  useEffect(() => {
    if (!ready || !earned) return;
    const seen = readSeen(address);
    if (seen === null) writeSeen(address, earned);
    else setFresh(earned.filter((id) => !seen.includes(id)));
  }, [address, ready, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const seen = (id: string) => {
    writeSeen(address, [...new Set([...(readSeen(address) ?? []), id])]);
    setFresh((f) => f.filter((x) => x !== id));
  };
  return { fresh, seen };
}

/** /profile (yours) and /u/:name or /u/:address (anyone's, shareable). */
export default function ProfilePage() {
  const { id } = useParams();
  const { address: me } = useWallet();
  if (!id) {
    if (!me) return <NotConnected />;
    return <ProfileView key={me} address={me} />;
  }
  if (isAddress(id)) return <ProfileView key={id} address={getAddress(id)} />;
  return <ByName name={id.toLowerCase()} />;
}

function NotConnected() {
  return (
    <PageScroll>
      <PageHeader
        label="Profile"
        lead="Your"
        accent="profile."
        subtitle="Your crystals, badges and history in one place, with a page you can share."
        guide={
          <GuideNote index={3} action={<WalletButton variant="hero" />}>
            Connect your wallet to see your profile.
          </GuideNote>
        }
      />
    </PageScroll>
  );
}

function ByName({ name }: { name: string }) {
  const lookup = useAddressOfName(name);
  if (lookup.data) return <ProfileView key={lookup.data} address={lookup.data} />;
  const note = !profilesContract()
    ? 'Usernames turn on once the profiles contract is deployed. Until then, profiles are at /u/ followed by an address.'
    : lookup.isLoading
      ? null
      : lookup.isError
        ? 'Couldn’t look that name up right now. Try again in a moment.'
        : `Nobody has ${atName(name)} yet.`;
  return (
    <PageScroll>
      <PageHeader label="Profile" lead={atName(name)} subtitle="A PRISM profile." guide={note && <GuideNote index={3}>{note}</GuideNote>} />
      {!note && <LoadingStage label="Looking up the name…" />}
    </PageScroll>
  );
}

function ProfileView({ address }: { address: Address }) {
  const { address: me } = useWallet();
  const mine = same(me, address);
  const deployment = getDeployment(TARGET_CHAIN.id);
  const { profile } = useProfile(address);
  const crystals = useMyCrystals(address);
  const live = useTestnetTokens(earliestForge(crystals.data));
  const events = useCrystalEvents();

  const marketOf = useMemo<MarketOf>(() => {
    const byAddress = new Map<string, LiveToken>();
    if (live.status === 'live') for (const t of live.tokens) byAddress.set(t.address.toLowerCase(), t);
    const weth = live.status === 'live' ? live.tokens.find((t) => t.id === 'WETH') : undefined;
    return (token) => (token ? byAddress.get(token.toLowerCase()) : weth);
  }, [live]);
  const owned = useMemo(() => crystals.data ?? [], [crystals.data]);
  const valued = useMemo(() => new Map(owned.map((c) => [c.id, valueCrystal(c, marketOf)])), [owned, marketOf]);
  const histories = useMemo(() => new Map(owned.map((c) => [c.id, realCrystalHistory(live, c)])), [owned, live]);
  const seams = (id: bigint) => histories.get(id)?.drawdowns.filter((d) => d.recovered).length ?? 0;

  const activity = useMemo(() => (events.data ? activityOf(events.data, address, deployment?.forgeRouter) : null), [events.data, address, deployment]);
  const forged = activity?.filter((a) => a.kind === 'forged') ?? null;
  const times = useBlockTimes([...(activity ?? []).map((a) => a.block), ...owned.flatMap((c) => (c.forgedBlock ? [c.forgedBlock] : []))]);
  const timeOf = (b: bigint | null | undefined) => (b ? times.data?.get(b) : undefined);
  const joined = forged && forged.length > 0 ? timeOf(forged[forged.length - 1]!.block) : undefined;
  const oldest = owned.reduce<number | undefined>((m, c) => {
    const t = timeOf(c.forgedBlock);
    return t !== undefined && (m === undefined || t < m) ? t : m;
  }, undefined);
  const priced = live.status === 'live';
  const totalEth = [...valued.values()].reduce((s, v) => s + v.totalEth, 0);
  const totalSeams = owned.reduce((s, c) => s + seams(c.id), 0);
  const badges = activity ? badgesOf({ activity, owned: owned.map((c) => ({ id: c.id, assets: c.assets.length, goldSeams: seams(c.id) })) }) : null;

  const avatarCrystal = profile.avatarId ? owned.find((c) => c.id === profile.avatarId) : undefined;
  const loaded = crystals.isSuccess && !!activity;
  // badges need prices too (Kintsugi counts gold seams), so only compare once both are in
  const newBadges = useNewBadges(address, badges?.filter((b) => b.isEarned).map((b) => b.id) ?? null, mine && loaded && priced);
  const empty = loaded && owned.length === 0 && activity.length === 0;
  const editor = useProfileEditor();
  const guide = empty ? (
    <GuideNote
      index={mine ? 7 : 3}
      action={
        mine ? (
          <Link to="/forge" className="btn btn-primary">
            Forge a crystal
          </Link>
        ) : undefined
      }
    >
      {mine ? 'Nothing here yet. Forge your first crystal and it shows up on your profile.' : 'This wallet hasn’t forged or held a PRISM crystal yet.'}
    </GuideNote>
  ) : mine && loaded && editor.available && !profile.name ? (
    <GuideNote
      index={5}
      action={
        <button className="btn btn-primary" onClick={editor.open}>
          Claim a username
        </button>
      }
    >
      Claim a username so people see your name instead of your address.
    </GuideNote>
  ) : undefined;

  return (
    <PageScroll>
      <header>
        <ProfileHeader
          address={address}
          profile={profile}
          mine={mine}
          joined={joined}
          forgedCount={forged ? forged.length : null}
          avatar={avatarCrystal ? { holdings: valued.get(avatarCrystal.id)!.holdings, history: histories.get(avatarCrystal.id), sealed: avatarCrystal.sealedUntil * 1000 > Date.now() } : null}
        />
        {guide && <div className="mt-8">{guide}</div>}
      </header>

      <section aria-label="Stats" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 lg:grid-cols-5">
        <Stat label="Crystals owned" value={crystals.isSuccess ? String(owned.length) : '…'} />
        <Stat
          label="Total value"
          value={
            crystals.isSuccess && priced ? (
              <>
                {formatEth(totalEth).replace(' ETH', '')}
                <span className="ml-1 font-mono text-[10px] font-normal text-mist sm:text-xs">ETH</span>
              </>
            ) : (
              '…'
            )
          }
        />
        <Stat label="Forged ever" value={forged ? String(forged.length) : '…'} />
        <Stat
          label="Oldest crystal"
          value={!crystals.isSuccess ? '…' : oldest === undefined ? (owned.length ? '…' : '—') : `${Math.floor((Date.now() / 1000 - oldest) / 86400)} days`}
        />
        <Stat label="Gold seams" value={crystals.isSuccess && priced ? String(totalSeams) : '…'} accent={totalSeams > 0} />
      </section>

      <section aria-labelledby="badges-title" className="flex flex-col gap-4">
        <SectionLabel>
          <span id="badges-title">Badges</span>
        </SectionLabel>
        {mine &&
          newBadges.fresh.map((id) => {
            const b = badges?.find((x) => x.id === id);
            if (!b) return null;
            return (
              <div key={id} role="status" className="flex flex-wrap items-center gap-4 rounded-[20px] border border-lime/40 bg-lime/[0.06] p-4 sm:p-5">
                <BadgeIcon id={b.id} earned />
                <div className="min-w-0 flex-1">
                  <p className="section-label text-[10px] !text-lime">New badge</p>
                  <p className="mt-1 font-display text-lg font-bold text-white">{b.name}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ShareOnX text={SHARE.badge(b.name, profileLink(address, profile.name))} className="btn btn-primary" onClick={() => newBadges.seen(id)} />
                  <button type="button" className="btn btn-outline" onClick={() => newBadges.seen(id)}>
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {(badges ?? []).map((b) => (
            <li key={b.id} className={`card flex items-start gap-4 p-5 ${b.isEarned ? '' : 'opacity-60'}`}>
              <BadgeIcon id={b.id} earned={b.isEarned} />
              <div className="min-w-0 flex-1">
                <p className={`font-display text-lg font-bold ${b.isEarned ? 'text-white' : 'text-mist'}`}>{b.name}</p>
                <p className="mt-1 text-[13px] leading-snug text-mist">{b.isEarned ? b.earned : `How to earn it: ${b.how}`}</p>
              </div>
              {mine && b.isEarned && (
                <ShareOnX
                  text={SHARE.badge(b.name, profileLink(address, profile.name))}
                  label="Share"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-mist transition-colors hover:border-white/30 hover:text-white"
                />
              )}
            </li>
          ))}
          {!badges && <li className="col-span-full text-sm text-mist">Reading the chain…</li>}
        </ul>
      </section>

      <div className="grid grid-cols-12 gap-6">
        <section aria-labelledby="crystals-title" className="col-span-12 flex min-w-0 flex-col gap-4 lg:col-span-7">
          <SectionLabel>
            <span id="crystals-title">Crystals</span>
          </SectionLabel>
          {crystals.isLoading && <p className="text-sm text-mist">Reading crystals from the chain…</p>}
          {crystals.isSuccess && owned.length === 0 && <p className="text-sm text-mist">No crystals in this wallet right now.</p>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {owned.map((c) => (
              <li key={c.id.toString()}>
                <CrystalCard crystal={c} valued={valued.get(c.id)!} history={histories.get(c.id)} priced={priced} mine={mine} />
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="activity-title" className="col-span-12 flex min-w-0 flex-col gap-4 lg:col-span-5">
          <SectionLabel>
            <span id="activity-title">Activity</span>
          </SectionLabel>
          {!activity && <p className="text-sm text-mist">{events.isError ? 'Couldn’t read activity right now.' : 'Reading the chain…'}</p>}
          {activity && activity.length === 0 && <p className="text-sm text-mist">No activity yet.</p>}
          {activity && activity.length > 0 && <ActivityFeed items={activity} timeOf={timeOf} />}
        </section>
      </div>
    </PageScroll>
  );
}

function ProfileHeader(props: {
  address: Address;
  profile: Profile;
  mine: boolean;
  joined?: number;
  /** null while events load */
  forgedCount: number | null;
  avatar: { holdings: Valued['holdings']; history?: CrystalHistory; sealed: boolean } | null;
}) {
  const { address, profile, mine, joined, forgedCount, avatar } = props;
  const editor = useProfileEditor();
  const gem = useMemo(() => identicon(address), [address]);
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
    <div className="grid grid-cols-12 items-center gap-6">
      <div className="col-span-12 sm:col-span-5 lg:col-span-4">
        <div className="relative mx-auto aspect-square w-full max-w-[240px] sm:max-w-[320px] overflow-hidden rounded-[32px] border border-white/[0.08] bg-panel sm:mx-0">
          <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
            {avatar ? (
              <FittedCrystal holdings={avatar.holdings} history={avatar.history} sealed={avatar.sealed} size={1.6} sway top={0.08} bottom={0.92} />
            ) : (
              <FittedCrystal holdings={gem.holdings} hue={gem.hue} size={1.6} spin={0.25} top={0.08} bottom={0.92} />
            )}
          </Stage>
        </div>
        {avatar && (
          <AssetDots holdings={avatar.holdings} sealed={avatar.sealed} className="mx-auto mt-3 max-w-[240px] justify-center sm:mx-0 sm:max-w-[320px] sm:justify-start" />
        )}
      </div>
      <div className="col-span-12 min-w-0 sm:col-span-7 lg:col-span-8">
        <SectionLabel>{mine ? 'Your profile' : 'Profile'}</SectionLabel>
        <h1 className="display-md mt-4 break-words">{profile.name ? atName(profile.name) : shortAddress(address)}</h1>
        <a href={explorerAddressUrl(address)} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all font-mono text-[11px] text-mist hover:text-lime" title="View on explorer">
          {address} ↗
        </a>
        {profile.bio && <p className="body-copy mt-5 break-words">{profile.bio}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-mist">
          {profile.x && (
            <a
              href={xUrl(profile.x)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 text-white hover:text-lime"
              title="Unverified: anyone can set any handle"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
                <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.42 4.7H5.6l11.07 14.5Z" />
              </svg>
              @{profile.x}
              <span className="text-[11px] text-mist">(unverified)</span>
            </a>
          )}
          <span>
            {joined !== undefined
              ? `Joined ${new Date(joined * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
              : forgedCount === 0
                ? 'Hasn’t forged yet'
                : 'Joined …'}
          </span>
        </div>
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

function Stat({ label, value, accent = false }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="card min-w-0 px-4 py-4 sm:px-6 sm:py-5">
      <p className="section-label truncate text-[10px] sm:text-[11px]">{label}</p>
      <p className={`mt-2 truncate font-display text-xl font-bold tracking-[-0.02em] sm:text-2xl ${accent ? 'text-gold' : ''}`}>{value}</p>
    </div>
  );
}

function CrystalCard({ crystal, valued, history, priced, mine }: { crystal: OnchainCrystal; valued: Valued; history?: CrystalHistory; priced: boolean; mine: boolean }) {
  const sealed = crystal.sealedUntil * 1000 > Date.now();
  const body = (
    <>
      <span className="flex w-full items-center gap-4">
        <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-2xl bg-ink">
          <CrystalThumb holdings={valued.holdings} history={history} sealed={sealed} size={64} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-bold">
            #{crystal.id.toString()} {sealed && <span className="text-[13px] font-normal text-[#bfe6ff]">sealed</span>}
          </span>
          <span className="mt-1 block font-mono text-xs text-white">{priced ? formatEth(valued.totalEth) : '…'}</span>
          <span className="mt-0.5 block text-xs">
            {valued.change24h != null ? (
              <>
                <Change value={valued.change24h} /> <span className="text-mist">24h</span>
              </>
            ) : (
              <span className="text-mist">
                {crystal.assets.length} asset{crystal.assets.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </span>
        {mine && (
          <span aria-hidden className="text-mist">
            →
          </span>
        )}
      </span>
      {/* the key to the thumbnail's colours */}
      <AssetDots holdings={valued.holdings} sealed={sealed} className="px-1 pb-0.5" />
    </>
  );
  const cls = 'flex w-full flex-col gap-3 rounded-[20px] border border-white/[0.08] bg-panel p-3 text-left';
  const card = mine ? (
    <Link to={`/my-crystals?id=${crystal.id}`} className={`${cls} transition-colors hover:border-white/25`} aria-label={`Open crystal #${crystal.id} in My Crystals`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {card}
      <Link to={`/replay/${crystal.id}`} className="self-end px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mist hover:text-lime">
        ▶ Replay
      </Link>
    </div>
  );
}

const VERB: Record<ActivityItem['kind'], string> = {
  forged: 'Forged',
  added: 'Added to',
  withdrew: 'Withdrew from',
  sealed: 'Sealed',
  gifted: 'Gave',
  received: 'Received',
  burned: 'Emptied and burned',
};

function ActivityFeed({ items, timeOf }: { items: ActivityItem[]; timeOf: (b: bigint) => number | undefined }) {
  const others = useProfiles(items.map((a) => a.counterparty));
  return (
    <ol className="card divide-y divide-white/[0.06] px-5">
      {items.slice(0, 50).map((a) => {
        const t = timeOf(a.block);
        const who = a.counterparty;
        return (
          <li key={`${a.tx}-${a.logIndex}`} className="flex items-start gap-3 py-3.5">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.kind === 'gifted' || a.kind === 'received' ? 'bg-gold' : a.kind === 'burned' ? 'bg-down' : 'bg-lime'}`} aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex flex-wrap items-center gap-x-1.5 text-white">
                <span>{VERB[a.kind]}</span>
                <span className="font-mono">#{a.id.toString()}</span>
                {who && (
                  <>
                    <span className="text-mist">{a.kind === 'gifted' ? 'to' : 'from'}</span>
                    <OwnerChip address={who} profile={others.get(who.toLowerCase())} size={18} className="text-white" />
                  </>
                )}
                {a.kind === 'sealed' && a.unlockTime && (
                  <span className="text-mist">until {new Date(a.unlockTime * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                )}
              </p>
              <p className="mt-0.5 text-[12px] text-mist">
                {t !== undefined ? timeAgo(t) : '…'} ·{' '}
                <a href={explorerTx(a.tx)} target="_blank" rel="noreferrer" className="hover:text-lime">
                  view transaction ↗
                </a>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Small line icons, lime when earned, grey when not. */
function BadgeIcon({ id, earned }: { id: BadgeId; earned: boolean }) {
  const paths: Record<BadgeId, ReactNode> = {
    'first-forge': <path d="M12 3l2.2 5.6L20 9.2l-4.4 3.9 1.3 5.9L12 16l-4.9 3 1.3-5.9L4 9.2l5.8-.6L12 3Z" />,
    kintsugi: <path d="M12 3 4 9l8 12 8-12-8-6Zm-2 5 3 3-2 3 3 3" />,
    diversified: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
    gifter: <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1Zm0 0c1.5-3 5-3 5-1s-3 1-5 1Z" />,
    sealed: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
    early: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 3" />,
  };
  return (
    <span
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border ${
        earned ? (id === 'kintsugi' ? 'border-gold/50 bg-gold/10 text-gold' : 'border-lime/40 bg-lime/[0.08] text-lime') : 'border-white/10 bg-white/[0.02] text-mist/60'
      }`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {paths[id]}
      </svg>
    </span>
  );
}
