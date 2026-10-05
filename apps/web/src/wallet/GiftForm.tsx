import { useState } from 'react';
import type { Address } from 'viem';
import {
  NOTE_MAX,
  atName,
  localDateTimeToUnix,
  noteProblem,
  parseRecipient,
  planGift,
  recipientProblem,
  type CrystalHistory,
  type Holding,
  type OnchainCrystal,
} from '@prism/core';
import { FittedCrystal } from '../components/Crystal';
import { GiftCard } from '../components/GiftCard';
import { Stage } from '../components/Stage';
import { Avatar, shortAddress, useAddressOfName, useProfile, type Profile } from '../data/profiles';
import { giftSteps } from './gift';
import { StepList, useTxSteps } from './steps';

const FIELD = 'w-full rounded border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-lime/60';
const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString();

export interface SentGift {
  id: bigint;
  to: Address;
  toLabel: string;
}

/**
 * Give a crystal away: to an @username or a 0x address, with an optional public note and
 * an optional opening date (sealed first, then sent). No new contract: seal() and
 * safeTransferFrom(from, to, id, note) on PrismCrystal.
 */
export function GiftForm({
  crystal,
  owner,
  ownerProfile,
  contract,
  holdings,
  history,
  onSent,
}: {
  crystal: OnchainCrystal;
  owner: Address;
  ownerProfile?: Profile;
  contract: Address;
  holdings: Holding[];
  history?: CrystalHistory;
  onSent: (gift: SentGift) => void;
}) {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [ack, setAck] = useState(false);
  const { steps, running, run } = useTxSteps();

  // recipient: a 0x address, or an @username looked up on PrismProfiles
  const parsed = parseRecipient(to);
  const lookup = useAddressOfName(parsed.kind === 'name' ? parsed.name : undefined);
  const resolved: Address | null = parsed.kind === 'address' ? parsed.address : parsed.kind === 'name' ? (lookup.data ?? null) : null;
  const { profile: toProfile } = useProfile(resolved ?? undefined);
  const toProblem =
    parsed.kind === 'invalid'
      ? parsed.problem
      : parsed.kind === 'name' && lookup.isError
        ? 'Couldn’t look that name up right now. Try again, or paste their 0x address.'
        : parsed.kind === 'name' && lookup.data === null
          ? `Nobody has ${atName(parsed.name)} yet. Check the spelling, or paste their 0x address.`
          : resolved
            ? recipientProblem(resolved, owner)
            : null;
  const checking = parsed.kind === 'name' && lookup.isLoading;
  const toLabel = toProfile.name ? atName(toProfile.name) : parsed.kind === 'name' ? atName(parsed.name) : resolved ? shortAddress(resolved) : '';

  const unlock = localDateTimeToUnix(when);
  const now = Math.floor(Date.now() / 1000);
  const plan = planGift({ unlock, sealedUntil: crystal.sealedUntil, now });
  const nProblem = noteProblem(note);
  const noteLen = [...note.trim()].length;
  const minLocal = new Date(Math.max(now, crystal.sealedUntil) * 1000 + 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const ready = !!resolved && !toProblem && !checking && !nProblem && !plan.problem && ack && !running;
  const sealing = plan.steps.includes('seal');

  const go = async () => {
    if (!resolved) return;
    const ok = await run(giftSteps({ crystal: contract, account: owner, id: crystal.id, to: resolved, toLabel, note, unlock, steps: plan.steps }));
    if (ok) onSent({ id: crystal.id, to: resolved, toLabel });
  };

  return (
    <div className="space-y-4">
      <p className="rounded border border-down/50 bg-down/10 p-3 text-sm text-[#ffd0cf]">
        <b>Gifting is permanent.</b> Once sent, crystal #{crystal.id.toString()} and everything inside belong to them: only they can take
        things out or send it back.
      </p>

      <label className="block">
        <span className="mb-1 block text-xs text-mist">To: an @username or a 0x address</span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          disabled={running}
          placeholder="@friend or 0x…"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`${FIELD} font-mono`}
        />
        <span className="mt-1.5 flex min-h-[1.5rem] items-center gap-2 text-[12px]">
          {checking ? (
            <span className="text-mist">Looking up {parsed.kind === 'name' ? atName(parsed.name) : ''}…</span>
          ) : toProblem ? (
            <span className="text-down">{toProblem}</span>
          ) : resolved ? (
            <>
              <Avatar address={resolved} avatarId={toProfile.avatarId} size={20} />
              <span className="text-white">{toProfile.name ? atName(toProfile.name) : shortAddress(resolved)}</span>
              <span className="truncate font-mono text-[11px] text-mist" title={resolved}>
                {resolved}
              </span>
            </>
          ) : null}
        </span>
      </label>

      <label className="block">
        <span className="mb-1 flex justify-between text-xs">
          <span className="text-mist">Note (optional)</span>
          <span className={`font-mono ${noteLen > NOTE_MAX ? 'text-down' : 'text-mist'}`}>
            {noteLen} / {NOTE_MAX}
          </span>
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} disabled={running} placeholder="Happy birthday!" className={FIELD} />
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
          <b>A seal can’t be shortened or removed, by anyone.</b> Until {fmtDate(unlock!)} nothing can be taken out of this crystal, not
          by you and not by them. It is sealed first (while it’s still yours), then sent.
        </p>
      )}

      {/* preview: the crystal as they will see it, wrapped in ice, with the note */}
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
          // a crystal that is already sealed stays sealed: it opens at the later of the two dates
          unlock={plan.problem ? 0 : Math.max(unlock ?? 0, crystal.sealedUntil > now ? crystal.sealedUntil : 0)}
          now={now}
        >
          <span className="font-mono text-[11px] text-mist">for {toLabel || '…'}</span>
        </GiftCard>
      </div>

      <label className="flex items-start gap-2 text-xs text-mist">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#d4f000]" />
        I understand crystal #{crystal.id.toString()} becomes {toLabel || 'theirs'}’s for good{sealing ? ', sealed until that date' : ''}.
      </label>
      <button className="btn btn-primary w-full" disabled={!ready} onClick={go}>
        {running ? 'Working…' : sealing ? 'Seal & send gift' : 'Send gift'}
      </button>
      {plan.steps.length > 0 && steps.length === 0 && resolved && !toProblem && (
        <p className="text-center font-mono text-[11px] text-mist">
          {sealing ? 'Two transactions: Seal 1/2 → Send 2/2' : 'One transaction: Send 1/1'}
        </p>
      )}
      <StepList steps={steps} />
    </div>
  );
}
