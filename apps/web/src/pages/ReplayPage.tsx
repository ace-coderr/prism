import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Address } from 'viem';
import { CrystalLinks, DeepNav, ForgeCta } from '../components/DeepNav';
import { LoadingStage } from '../components/LoadingStage';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { GuideNote } from '../components/Viber';
import { crystalCrumbs, crystalHref } from '../data/nav';
import { atNameOrShort, useProfile, useProfiles } from '../data/profiles';
import { useReplay } from '../data/replay';
import { ReplayPlayer } from '../replay/ReplayPlayer';
import { useWallet } from '../wallet/WalletButton';

/** /replay/:id, a crystal's life as a short time-lapse, made in the browser from real data. */
export default function ReplayPage() {
  const { id: raw } = useParams();
  const id = /^\d+$/.test(raw ?? '') ? BigInt(raw!) : null;
  const { crystal, timeline, loading, error } = useReplay(id);
  const { profile } = useProfile(crystal?.owner);
  const { address: viewer } = useWallet();
  const mine = !!viewer && !!crystal && viewer.toLowerCase() === crystal.owner.toLowerCase();
  const recipients = useProfiles((timeline?.events ?? []).flatMap((e) => (e.to ? [e.to] : [])));
  const info = useMemo(
    () =>
      id === null || !crystal
        ? null
        : {
            id,
            owner: atNameOrShort(crystal.owner, profile.name),
            nameOf: (a: Address) => atNameOrShort(a, recipients.get(a.toLowerCase())?.name),
          },
    [id, crystal, profile.name, recipients],
  );

  const header = (subtitle: string) => (
    <div className="flex flex-col gap-8 md:gap-10">
      <DeepNav crumbs={crystalCrumbs(id, 'Replay', id !== null ? crystalHref(id, crystal?.owner, viewer) : '/gallery')} />
      <PageHeader label="Replay" lead="Crystal" accent={id !== null ? `#${id}` : ''} subtitle={subtitle} />
    </div>
  );
  if (id === null) return <PageScroll>{header('That isn’t a crystal number.')}</PageScroll>;
  if (!crystal && !loading) {
    return (
      <PageScroll>
        {header(error ? 'Couldn’t read the chain right now. Try again in a moment.' : 'This crystal doesn’t exist (or was burned).')}
        <GuideNote index={8} action={<Link to="/gallery" className="btn btn-primary">See every crystal</Link>}>
          Every crystal on PRISM has a replay. Pick one in the Gallery.
        </GuideNote>
      </PageScroll>
    );
  }
  return (
    <PageScroll>
      {header('Its life from the forge to now, in a few seconds: what went in, how it moved, every crack and gold seam. Made from real on-chain data.')}
      {!timeline || !info ? (
        error ? (
          <p className="text-sm text-down">Couldn’t read its history right now. Try again in a moment.</p>
        ) : (
          <LoadingStage label="Reading its history from the chain…" />
        )
      ) : (
        <div className="flex flex-col gap-8">
          <ReplayPlayer key={timeline.id.toString()} timeline={timeline} info={info} />
          {crystal && id !== null && <CrystalLinks id={id} owner={crystal.owner} ownerName={profile.name} viewer={viewer} />}
        </div>
      )}
      {!mine && <ForgeCta />}
    </PageScroll>
  );
}
