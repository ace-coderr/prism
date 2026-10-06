import { Link, useParams } from 'react-router-dom';
import { useReadContract } from 'wagmi';
import { getDeployment, prismCrystalAbi } from '@prism/core';
import { FittedCrystal } from '../components/Crystal';
import { CrystalLinks, DeepNav, ForgeCta } from '../components/DeepNav';
import { GiftCard } from '../components/GiftCard';
import { LoadingStage } from '../components/LoadingStage';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stage } from '../components/Stage';
import { GuideNote } from '../components/Viber';
import { useGalleryCrystals } from '../data/crystals';
import { useGift, useGiftNote, useNow } from '../data/gifts';
import { crystalCrumbs, crystalHref } from '../data/nav';
import { atNameOrShort, useCrystalShapes, useProfile } from '../data/profiles';
import { TARGET_CHAIN } from '../wallet/config';
import { WalletButton, useWallet } from '../wallet/WalletButton';

/** /gift/:id, the shareable gift: the crystal in its ice, who it's from, the note and when it opens. */
export default function GiftPage() {
  const { id: raw } = useParams();
  const id = /^\d+$/.test(raw ?? '') ? BigInt(raw!) : null;
  const gallery = useGalleryCrystals();
  const crystal = id === null ? undefined : gallery.crystals?.find((c) => c.id === id);
  const shape = useCrystalShapes().get(id ?? -1n);
  const { gift, error } = useGift(id);
  const note = useGiftNote(gift);
  const { profile: sender } = useProfile(gift?.from);
  const { profile: recipient } = useProfile(gift?.to);
  const { address, isConnected } = useWallet();
  const now = useNow();
  // when it opens, straight from the contract (the gallery list may still be a cached snapshot)
  const deployment = getDeployment(TARGET_CHAIN.id);
  const sealed = useReadContract({
    address: deployment?.prismCrystal,
    abi: prismCrystalAbi,
    functionName: 'sealedUntil',
    args: id !== null ? [id] : undefined,
    chainId: TARGET_CHAIN.id,
    query: { enabled: !!deployment && id !== null && !!gift },
  });

  // who holds it: the gift's recipient once it's known (the gallery may still be a cached snapshot)
  const owner = gift?.to ?? crystal?.owner;
  const header = (lead: string, subtitle: string) => (
    <div className="flex flex-col gap-8 md:gap-10">
      <DeepNav crumbs={crystalCrumbs(id, 'Gift', id !== null ? crystalHref(id, owner, address) : '/gallery')} />
      <PageHeader label="Gift" lead={lead} accent={id !== null ? `#${id}` : ''} subtitle={subtitle} />
    </div>
  );

  if (id === null) return <PageScroll>{header('A PRISM', 'That isn’t a crystal number.')}</PageScroll>;
  if (gallery.loading || gift === undefined || (gift && sealed.isLoading)) {
    return (
      <PageScroll>
        {header('A gift:', 'Reading it from the chain…')}
        {error ? <p className="text-sm text-down">Couldn’t read the chain right now. Try again in a moment.</p> : <LoadingStage label="Unwrapping the details…" />}
      </PageScroll>
    );
  }
  // the event log is the authority on who holds it (the gallery may still be a cached snapshot)
  if (!crystal || !gift) {
    return (
      <PageScroll>
        {header('Crystal', !crystal ? 'This crystal doesn’t exist (or was burned).' : 'This crystal hasn’t been given as a gift.')}
        <GuideNote index={8} action={<Link to="/gallery" className="btn btn-primary">See every crystal</Link>}>
          Gifts get their own page once they’re sent from My Crystals.
        </GuideNote>
      </PageScroll>
    );
  }

  const sealedUntil = sealed.data !== undefined ? Number(sealed.data) : crystal.sealedUntil;
  const unlock = sealedUntil > now ? sealedUntil : 0;
  const mine = !!address && address.toLowerCase() === gift.to.toLowerCase();
  return (
    <PageScroll>
      {header('A gift:', `For ${atNameOrShort(gift.to, recipient.name)}, from ${atNameOrShort(gift.from, sender.name)}.`)}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 flex flex-col gap-5 lg:col-span-7">
          <div className="relative h-[340px] overflow-hidden rounded-[24px] border border-[#bfe6ff]/20 bg-panel sm:h-[440px]">
            <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
              {shape && shape.holdings.length > 0 && (
                <FittedCrystal holdings={shape.holdings} history={shape.history} sealed identify={false} size={1.6} spin={0.2} top={0.08} bottom={0.92} />
              )}
            </Stage>
          </div>
          <CrystalLinks id={id} owner={gift.to} ownerName={recipient.name} viewer={address} />
        </div>
        <div className="col-span-12 flex flex-col gap-5 lg:col-span-5">
          <GiftCard label="A gift from" who={gift.from} profile={sender} note={note.data ?? null} noteLoading={note.isLoading} unlock={unlock} now={now} />
          <div className="card p-5">
            {mine ? (
              <>
                <p className="text-white">This gift is yours.</p>
                <p className="mt-1 text-sm text-mist">{unlock ? 'You can unwrap it once it opens.' : 'Unwrap it in My Crystals.'}</p>
                <Link to={`/my-crystals?id=${id}`} className="btn btn-primary mt-4">
                  {unlock ? 'See it in My Crystals' : 'Unwrap it'}
                </Link>
              </>
            ) : isConnected ? (
              <p className="text-sm text-mist">This gift was sent to another wallet. Connect the wallet it was sent to, to unwrap it.</p>
            ) : (
              <>
                <p className="text-white">Is this gift for you?</p>
                <p className="mt-1 text-sm text-mist">Connect the wallet it was sent to, to unwrap it.</p>
                <div className="mt-4">
                  <WalletButton variant="hero" />
                </div>
              </>
            )}
          </div>
          <Link to={`/replay/${id}`} className="font-mono text-xs uppercase tracking-[0.14em] text-lime hover:underline">
            ▶ Watch its replay
          </Link>
        </div>
      </div>
      {!mine && <ForgeCta />}
    </PageScroll>
  );
}
