import { useEffect, useRef, useState } from 'react';
import { formatEther, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import QRCode from 'qrcode';
import {
  LINK_DAYS_DEFAULT,
  LINK_DAY_CHOICES,
  LINK_GAS_DEFAULT,
  NOTE_MAX,
  claimPath,
  localDateTimeToUnix,
  noteProblem,
  parseTokenAmount,
  planGift,
  type CrystalHistory,
  type Holding,
  type OnchainCrystal,
} from '@prism/core';
import { FittedCrystal } from '../components/Crystal';
import { GiftCard } from '../components/GiftCard';
import { ShareOnX } from '../components/ShareOnX';
import { Stage } from '../components/Stage';
import { useSavedLinks } from '../data/giftLinks';
import type { Profile } from '../data/profiles';
import { SHARE, giftLinkText, giftLinkUrl } from '../data/share';
import { gasStep, giftLinkSteps } from './giftLink';
import { StepList, useTxSteps } from './steps';

const FIELD = 'w-full rounded border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-lime/60';
const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString();

export interface MadeLink {
  linkId: bigint;
  key: Hex;
  crystalId: bigint;
  /** false when the gas-money step didn't go through */
  funded: boolean;
}

/** The bearer warning, said the same way everywhere a link is shown. */
export function LinkWarning() {
  return (
    <p className="rounded border border-amber-300/50 bg-amber-300/[0.08] p-3 text-sm text-amber-100">
      <b>Anyone with this link can claim the crystal.</b> Share it privately.
    </p>
  );
}

/**
 * Send a crystal as a link: to someone who may not have a wallet yet. Their browser opens
 * /claim/<id>#k=<key>; the key (made here, in your browser) never reaches any server.
 */
export function GiftLinkForm({
  crystal,
  owner,
  ownerProfile,
  contract,
  giftLinks,
  holdings,
  history,
  onLinked,
}: {
  crystal: OnchainCrystal;
  owner: Address;
  ownerProfile?: Profile;
  contract: Address;
  giftLinks: Address;
  holdings: Holding[];
  history?: CrystalHistory;
  onLinked: (link: MadeLink) => void;
}) {
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [days, setDays] = useState<number>(LINK_DAYS_DEFAULT);
  const [gasInput, setGasInput] = useState(formatEther(LINK_GAS_DEFAULT));
  const [ack, setAck] = useState(false);
  const { steps, running, run } = useTxSteps();
  const saved = useSavedLinks(owner);

  const unlock = localDateTimeToUnix(when);
  const now = Math.floor(Date.now() / 1000);
  const plan = planGift({ unlock, sealedUntil: crystal.sealedUntil, now });
  const sealing = plan.steps.includes('seal');
  const nProblem = noteProblem(note);
  const noteLen = [...note.trim()].length;
  const gas = gasInput.trim() === '' ? null : parseTokenAmount(gasInput, 18);
  const gasProblem = gas === null ? 'Enter the test ETH to send with the link (e.g. 0.0005).' : gas > 10n ** 16n ? 'That’s a lot: 0.0005 ETH covers a claim many times over.' : null;
  const minLocal = new Date(Math.max(now, crystal.sealedUntil) * 1000 + 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const ready = !nProblem && !plan.problem && !gasProblem && ack && !running;
  const n = (sealing ? 1 : 0) + 2;

  const go = async () => {
    if (!gas) return;
    // the one-time claim key: made here, kept in this browser and in the link, never sent anywhere
    const key = generatePrivateKey();
    const claimKey = privateKeyToAccount(key).address;
    const createdAt = Math.floor(Date.now() / 1000);
    saved.save({ key, crystalId: crystal.id.toString(), linkId: null, createdAt });
    let linkId: bigint | null = null;
    const ok = await run(
      giftLinkSteps({
        crystal: contract,
        giftLinks,
        account: owner,
        id: crystal.id,
        claimKey,
        expiry: createdAt + days * 86_400,
        note: note.trim(),
        unlock: sealing ? unlock : null,
        gas,
        onCreated: (id) => {
          linkId = id;
          saved.save({ key, crystalId: crystal.id.toString(), linkId: id.toString(), createdAt });
        },
      }),
    );
    if (linkId !== null) onLinked({ linkId, key, crystalId: crystal.id, funded: ok });
    else saved.forget(key); // nothing was made: no key to keep
  };

  return (
    <div className="space-y-4">
      <LinkWarning />

      <label className="block">
        <span className="mb-1 flex justify-between text-xs">
          <span className="text-mist">Note (optional)</span>
          <span className={`font-mono ${noteLen > NOTE_MAX ? 'text-down' : 'text-mist'}`}>
            {noteLen} / {NOTE_MAX}
          </span>
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} disabled={running} placeholder="Welcome to PRISM!" className={FIELD} />
        <span className={`mt-1.5 block text-[12px] ${nProblem ? 'text-down' : 'text-amber-300/90'}`}>
          {nProblem ?? 'Notes are public on-chain: anyone can read them, forever.'}
        </span>
      </label>

      <label className="block text-xs text-mist">
        Opens on (optional): sealed until then
        <input
          type="datetime-local"
          min={minLocal}
          value={when}
          disabled={running}
          onChange={(e) => setWhen(e.target.value)}
          className={`${FIELD} mt-1 font-mono text-white [color-scheme:dark]`}
        />
      </label>
      {plan.problem && <p className="text-xs text-down">· {plan.problem}</p>}
      {sealing && (
        <p className="rounded border border-[#bfe6ff]/40 bg-[#bfe6ff]/10 p-3 text-sm text-[#d9f1ff]">
          <b>A seal can’t be shortened or removed, by anyone.</b> Until {fmtDate(unlock!)} nothing can be taken out of this crystal. They can claim
          it before then; it opens on that date.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="text-xs text-mist">
          The link works for
          <div className="mt-1.5 flex flex-wrap gap-2">
            {LINK_DAY_CHOICES.map((d) => (
              <button key={d} type="button" disabled={running} className={`chip ${days === d ? 'chip-on' : ''}`} onClick={() => setDays(d)}>
                {d} days
              </button>
            ))}
          </div>
          <span className="mt-1.5 block text-[12px]">Unclaimed by then? You can take the crystal back (also any time before).</span>
        </div>
        <label className="block text-xs text-mist">
          Gas money for their claim (test ETH)
          <input value={gasInput} onChange={(e) => setGasInput(e.target.value)} disabled={running} inputMode="decimal" className={`${FIELD} mt-1 font-mono`} />
          <span className={`mt-1.5 block text-[12px] ${gasProblem ? 'text-down' : ''}`}>
            {gasProblem ?? 'Pays for the claim, so it costs them nothing. What’s left goes to them, a little test ETH to start.'}
          </span>
        </label>
      </div>

      {/* preview: what they'll see when they open the link */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative h-[220px] overflow-hidden rounded-[20px] border border-white/[0.08] bg-panel">
          <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
            {holdings.length > 0 && <FittedCrystal holdings={holdings} history={history} sealed size={1.4} spin={0.25} identify={false} top={0.06} bottom={0.94} />}
          </Stage>
        </div>
        <GiftCard
          label="A gift from"
          who={owner}
          profile={ownerProfile}
          note={nProblem ? null : note.trim() || null}
          unlock={plan.problem ? 0 : Math.max(unlock ?? 0, crystal.sealedUntil > now ? crystal.sealedUntil : 0)}
          now={now}
        >
          <span className="font-mono text-[11px] text-mist">for whoever opens the link</span>
        </GiftCard>
      </div>

      <label className="flex items-start gap-2 text-xs text-mist">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#d4f000]" />
        I understand anyone with the link can claim crystal #{crystal.id.toString()}{sealing ? ', sealed until that date' : ''}.
      </label>
      <button className="btn btn-primary w-full" disabled={!ready} onClick={go}>
        {running ? 'Working…' : 'Create gift link'}
      </button>
      {steps.length === 0 && (
        <p className="text-center font-mono text-[11px] text-mist">
          {n} transactions: {sealing ? 'Seal → ' : ''}Create the link → Gas money
        </p>
      )}
      <StepList steps={steps} />
    </div>
  );
}

/** The link, ready to share: copy, QR, Share on X, and the bearer warning. */
export function GiftLinkReady({ link, onClose }: { link: MadeLink; onClose?: () => void }) {
  const path = claimPath(link.linkId, link.key);
  const url = giftLinkUrl(path);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [funded, setFunded] = useState(link.funded);
  const top = useTxSteps();
  // it appears at the top of the page while you're down at the form: bring it into view
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // a block body: scrollIntoView returns a Promise in current browsers, and an effect must return nothing
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#101214', light: '#ffffff' } })
      .then((d) => live && setQr(d))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [url]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the link is right there to select */
    }
  };
  const addGas = async () => {
    const ok = await top.run([gasStep(privateKeyToAccount(link.key).address, LINK_GAS_DEFAULT)]);
    if (ok) setFunded(true);
  };
  return (
    <section ref={ref} aria-live="polite" className="grid scroll-mt-28 gap-6 rounded-[20px] border border-lime/40 bg-lime/[0.06] p-5 md:grid-cols-[1fr_auto] md:p-6">
      <div className="min-w-0 space-y-4">
        <div>
          <p className="font-display text-xl font-bold text-white">Your gift link is ready</p>
          <p className="mt-1 text-sm text-mist">Crystal #{link.crystalId.toString()} waits in the link until someone opens it and claims it.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-lime" title={url}>
            {url}
          </code>
          <button type="button" className="chip shrink-0" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <LinkWarning />
        {!funded && (
          <div className="space-y-2 rounded border border-down/50 bg-down/10 p-3 text-sm text-[#ffd0cf]">
            <p>
              <b>The link has no gas money yet,</b> so claiming it would fail. Add {formatEther(LINK_GAS_DEFAULT)} test ETH:
            </p>
            <button type="button" className="btn btn-primary" disabled={top.running} onClick={addGas}>
              {top.running ? 'Working…' : 'Add gas money'}
            </button>
            <StepList steps={top.steps} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <ShareOnX text={SHARE.giftLink(giftLinkText(path))} />
          {onClose && (
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Done
            </button>
          )}
        </div>
        <p className="text-xs text-mist">
          On X it’s a giveaway: the first to open it keeps it. The link is saved in this browser: My gift links has it, to copy again or to take the
          crystal back.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="grid h-[180px] w-[180px] place-items-center overflow-hidden rounded-2xl bg-white p-2">
          {qr ? <img src={qr} alt="QR code of the gift link" className="h-full w-full" /> : <span className="text-xs text-ink">QR…</span>}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist">Scan to claim</span>
      </div>
    </section>
  );
}
