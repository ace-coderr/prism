import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatEther, type Address, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { useBalance, useReadContract } from 'wagmi';
import { claimKeyFromHash, explorerTx, getDeployment, linkState, opensIn, prismCrystalAbi } from '@prism/core';
import { FittedCrystal } from '../components/Crystal';
import { DeepNav, ForgeCta } from '../components/DeepNav';
import { GiftCard } from '../components/GiftCard';
import { LoadingStage } from '../components/LoadingStage';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stage } from '../components/Stage';
import { GuideNote } from '../components/Viber';
import { claimWithKey, giftLinksContract, sweepKey, useGiftLink } from '../data/giftLinks';
import { useNow, useOpenedGifts } from '../data/gifts';
import { atNameOrShort, profileHref, useCrystalShapes, useProfile } from '../data/profiles';
import { testnetClient } from '../data/chain';
import { TARGET_CHAIN } from '../wallet/config';
import { useSignIn } from '../wallet/signIn';
import { StepList, useTxSteps } from '../wallet/steps';
import { WalletButton, shortAddress, useWallet } from '../wallet/WalletButton';

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type Phase = 'idle' | 'login' | 'claiming' | 'unwrapping' | 'done';

/**
 * /claim/:id#k=<key>: a crystal sent as a link. The key in the fragment never reaches a
 * server; it signs the claim (paying its own fee) for whoever opens the link and logs in.
 */
export default function ClaimPage() {
  const { id: raw } = useParams();
  const { hash } = useLocation();
  const id = /^\d+$/.test(raw ?? '') ? BigInt(raw!) : null;
  const contract = giftLinksContract();
  const { link, error, refetch } = useGiftLink(contract ? id : null);
  const key = useMemo(() => claimKeyFromHash(hash), [hash]);
  const keyAddress = useMemo(() => (key ? privateKeyToAccount(key).address : null), [key]);
  const shape = useCrystalShapes().get(link?.crystalId ?? -1n);
  const { profile: sender } = useProfile(link?.sender);
  const { profile: claimer } = useProfile(link?.claimedBy ?? undefined);
  const { address, isConnected } = useWallet();
  const signIn = useSignIn();
  const now = useNow(15_000);
  const tx = useTxSteps();
  const queryClient = useQueryClient();
  const opened = useOpenedGifts(address);
  const [phase, setPhase] = useState<Phase>('idle');
  const [claimedTo, setClaimedTo] = useState<Address | null>(null);
  const [sweep, setSweep] = useState<{ hash: Hash; value: bigint } | 'sending' | null>(null);

  const crystalAddr = getDeployment(TARGET_CHAIN.id)?.prismCrystal;
  const sealedRead = useReadContract({
    address: crystalAddr,
    abi: prismCrystalAbi,
    functionName: 'sealedUntil',
    args: link ? [link.crystalId] : undefined,
    chainId: TARGET_CHAIN.id,
    query: { enabled: !!crystalAddr && !!link },
  });
  const sealedUntil = Number(sealedRead.data ?? 0n);
  const sealedNow = sealedUntil > now;
  const state = link ? linkState(link, now) : null;
  const keyMatches = !!link && !!keyAddress && keyAddress.toLowerCase() === link.claimKey.toLowerCase();
  const gasLeft = useBalance({ address: keyAddress ?? undefined, chainId: TARGET_CHAIN.id, query: { enabled: !!keyAddress && state === 'waiting' } });
  const fromLabel = link ? atNameOrShort(link.sender, sender.name) : '';

  const claim = async (to: Address) => {
    if (!key || !link) return;
    setPhase('claiming');
    const ok = await tx.run([{ label: `Claiming crystal #${link.crystalId} for ${shortAddress(to)}`, send: () => claimWithKey(key, link.id, to) }]);
    if (!ok) {
      setPhase('idle');
      return;
    }
    setClaimedTo(to);
    // the claim key's leftover gas money: theirs, a little test ETH to start
    setSweep('sending');
    try {
      const before = await testnetClient.getBalance({ address: to });
      const h = await sweepKey(key, to);
      if (h) {
        await testnetClient.waitForTransactionReceipt({ hash: h });
        setSweep({ hash: h, value: (await testnetClient.getBalance({ address: to })) - before });
      } else setSweep(null);
    } catch {
      setSweep(null);
    }
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['balance'] }); // wallet balances: the gas money arrived
    void queryClient.invalidateQueries({ queryKey: ['crystal-events'] });
    void queryClient.invalidateQueries({ queryKey: ['all-crystals'] });
    setPhase(sealedNow ? 'done' : 'unwrapping');
  };

  // logged in through the "Claim" button: claim as soon as the wallet is there
  useEffect(() => {
    if (phase === 'login' && address) void claim(address);
  }, [phase, address]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (lead: string, accent: string, subtitle: string) => (
    <div className="flex flex-col gap-8 md:gap-10">
      <DeepNav crumbs={[{ label: 'Gallery', to: '/gallery' }, { label: 'Gift link', to: `/claim/${raw ?? ''}${hash}` }]} />
      <PageHeader label="Gift link" lead={lead} accent={accent} subtitle={subtitle} />
    </div>
  );
  const note = (text: string, action?: ReactNode) => (
    <GuideNote index={8} action={action ?? <Link to="/gallery" className="btn btn-primary">See every crystal</Link>}>
      {text}
    </GuideNote>
  );

  if (!contract) return <PageScroll ethNote={false}>{header('A gift', 'link', 'Gift links aren’t switched on yet.')}</PageScroll>;
  if (id === null) return <PageScroll ethNote={false}>{header('A gift', 'link', 'That isn’t a gift link.')}</PageScroll>;
  if (link === undefined) {
    return (
      <PageScroll ethNote={false}>
        {header('A gift', 'for you', 'Reading it from the chain…')}
        {error ? <p className="text-sm text-down">Couldn’t read the chain right now. Try again in a moment.</p> : <LoadingStage label="Unwrapping the details…" />}
      </PageScroll>
    );
  }
  if (link === null) return <PageScroll ethNote={false}>{header('A gift', 'link', 'This gift link doesn’t exist.')}{note('Check that you opened the whole link. In the meantime, have a look around.')}</PageScroll>;

  const justClaimed = phase === 'unwrapping' || phase === 'done';
  const sub =
    justClaimed || (state === 'claimed' && claimedTo)
      ? `It’s yours now. From ${fromLabel}.`
      : state === 'claimed'
        ? `Already claimed by ${link.claimedBy ? atNameOrShort(link.claimedBy, claimer.name) : 'someone'}.`
        : state === 'cancelled'
          ? `${fromLabel} took this gift back.`
          : state === 'expired'
            ? `This link expired on ${fmtDate(link.expiry)}.`
            : `From ${fromLabel}. Claim it and it’s yours, in a wallet of your own.`;

  /** What the visitor can do, by state. */
  let action: ReactNode;
  if (justClaimed) {
    action = (
      <>
        <p className="text-white">Crystal #{link.crystalId.toString()} is in your wallet.</p>
        {sealedNow ? (
          <p className="mt-1 text-sm text-mist">It’s sealed: {opensIn(sealedUntil, now)?.toLowerCase()}. It unwraps then, in My Crystals.</p>
        ) : (
          <p className="mt-1 text-sm text-mist">{phase === 'unwrapping' ? 'Unwrapping…' : 'Unwrapped. Welcome to PRISM.'}</p>
        )}
        {sweep === 'sending' && <p className="mt-2 font-mono text-xs text-mist">Sending you the leftover test ETH…</p>}
        {sweep && sweep !== 'sending' && (
          <p className="mt-2 text-sm text-lime">
            + {Number(formatEther(sweep.value)).toLocaleString('en-US', { maximumSignificantDigits: 3 })} test ETH to start{' '}
            <a href={explorerTx(sweep.hash)} target="_blank" rel="noreferrer" className="font-mono text-xs text-lime/80 hover:text-lime">
              tx ↗
            </a>
          </p>
        )}
        <Link to={`/my-crystals?id=${link.crystalId}`} className="btn btn-primary mt-4">
          See it in My Crystals
        </Link>
      </>
    );
  } else if (state === 'claimed') {
    action = (
      <>
        <p className="text-white">This gift was already claimed.</p>
        {link.claimedBy && (
          <p className="mt-1 text-sm text-mist">
            It went to{' '}
            <Link to={profileHref(link.claimedBy, claimer.name)} className="text-lime hover:underline">
              {atNameOrShort(link.claimedBy, claimer.name)}
            </Link>
            . A gift link works once: the first to open it keeps it.
          </p>
        )}
      </>
    );
  } else if (state === 'cancelled') {
    action = <p className="text-sm text-mist">The sender took the crystal back before anyone claimed it, so there’s nothing to claim here.</p>;
  } else if (state === 'expired') {
    action = <p className="text-sm text-mist">Gift links can be claimed for a limited time. Ask {fromLabel} to send you a new one.</p>;
  } else if (!key) {
    action = (
      <>
        <p className="text-white">This link is missing its key.</p>
        <p className="mt-1 text-sm text-mist">The part after # is what lets you claim. Ask {fromLabel} for the whole link, or copy it again in full.</p>
      </>
    );
  } else if (!keyMatches) {
    action = (
      <>
        <p className="text-white">This key doesn’t match this gift.</p>
        <p className="mt-1 text-sm text-mist">The link may have been cut or changed. Ask {fromLabel} to send it again.</p>
      </>
    );
  } else {
    const noGas = gasLeft.data?.value === 0n;
    action = (
      <>
        <p className="text-white">{isConnected && address ? `Claim it to ${shortAddress(address)}?` : 'Is this gift for you?'}</p>
        <p className="mt-1 text-sm text-mist">
          {sealedNow
            ? `It’s sealed: ${opensIn(sealedUntil, now)?.toLowerCase()}. You can claim it now; it opens then.`
            : 'Free: the link pays its own fee. You also get a little test ETH to start.'}
        </p>
        {noGas && <p className="mt-2 text-sm text-down">This link has no test ETH left to pay for its claim. Ask {fromLabel} to add a little.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isConnected && address ? (
            <button className="btn btn-primary" disabled={tx.running || noGas || phase === 'claiming'} onClick={() => void claim(address)}>
              {tx.running ? 'Claiming…' : 'Claim it'}
            </button>
          ) : signIn.available ? (
            <button
              className="btn btn-primary"
              disabled={!signIn.ready || noGas}
              onClick={() => {
                setPhase('login');
                signIn.signIn();
              }}
            >
              Claim with email or wallet
            </button>
          ) : (
            <>
              <WalletButton variant="hero" />
              <span className="text-xs text-mist">Connect a wallet to claim it.</span>
            </>
          )}
        </div>
        {phase === 'login' && !address && <p className="mt-2 text-xs text-mist">Log in to claim it. Your wallet is made for you if you don’t have one.</p>}
      </>
    );
  }

  const showClaim = state === 'waiting' || justClaimed;
  return (
    <PageScroll ethNote={false}>
      {header(justClaimed ? 'It’s' : state === 'waiting' ? 'A gift' : 'A gift', justClaimed ? 'yours.' : 'for you', sub)}
      <div className="grid grid-cols-12 gap-6">
        <div className="relative col-span-12 h-[340px] overflow-hidden rounded-[24px] border border-[#bfe6ff]/20 bg-panel sm:h-[440px] lg:col-span-7">
          <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
            {shape && shape.holdings.length > 0 && (
              <FittedCrystal
                holdings={shape.holdings}
                history={shape.history}
                // in ice while it waits (or expired), until the unwrap, and whenever it's sealed
                sealed={sealedNow || (justClaimed ? phase !== 'done' : state === 'waiting' || state === 'expired')}
                unwrapping={phase === 'unwrapping'}
                onUnwrapped={() => {
                  opened.markOpened(link.crystalId);
                  setPhase('done');
                }}
                identify={false}
                size={1.6}
                spin={0.2}
                top={0.08}
                bottom={0.92}
              />
            )}
          </Stage>
        </div>
        <div className="col-span-12 flex flex-col gap-5 lg:col-span-5">
          <GiftCard
            label="A gift from"
            who={link.sender}
            profile={sender}
            note={link.note.trim() || null}
            unlock={sealedNow ? sealedUntil : 0}
            now={now}
            opened={phase === 'done' && !sealedNow}
          />
          <div className="card p-5">
            {action}
            <StepList steps={tx.steps} />
          </div>
          {showClaim && !justClaimed && <p className="text-xs text-mist">Claimable until {fmtDate(link.expiry)}.</p>}
        </div>
      </div>
      {(justClaimed || state !== 'waiting') && (
        <ForgeCta
          title={justClaimed ? 'Welcome to PRISM. Forge your own.' : 'A stock basket you can hold.'}
          text={justClaimed ? 'Pick a few test stocks and forge them into a crystal of your own, with the test ETH you just got.' : undefined}
        />
      )}
    </PageScroll>
  );
}
