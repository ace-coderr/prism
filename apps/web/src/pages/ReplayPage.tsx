import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Address } from 'viem';
import { LoadingStage } from '../components/LoadingStage';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { GuideNote } from '../components/Viber';
import { atNameOrShort, useProfile, useProfiles } from '../data/profiles';
import { useReplay } from '../data/replay';
import { ReplayPlayer } from '../replay/ReplayPlayer';

/** /replay/:id, a crystal's life as a short time-lapse, made in the browser from real data. */
export default function ReplayPage() {
  const { id: raw } = useParams();
  const id = /^\d+$/.test(raw ?? '') ? BigInt(raw!) : null;
  const { crystal, timeline, loading, error } = useReplay(id);
  const { profile } = useProfile(crystal?.owner);
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
    <PageHeader label="Replay" lead="Crystal" accent={id !== null ? `#${id}` : ''} subtitle={subtitle} />
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
        <ReplayPlayer key={timeline.id.toString()} timeline={timeline} info={info} />
      )}
    </PageScroll>
  );
}
