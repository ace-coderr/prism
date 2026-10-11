import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAddress, isAddress, type Address } from 'viem';
import { atName, explorerAddressUrl, xUrl } from '@prism/core';
import { DeepNav } from '../components/DeepNav';
import { useProfileEditor } from '../components/editorContext';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { SHARE, ShareOnX, XLogo, profileLink } from '../components/ShareOnX';
import { SectionLabel } from '../components/design';
import { GuideNote } from '../components/Viber';
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
        subtitle="Your @username and a page you can share."
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
      <GuideNote index={1}>
        {mine ? 'Your reviews will show here when the new PRISM opens.' : `${label}’s reviews will show here when the new PRISM opens.`}
      </GuideNote>
    </PageScroll>
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
