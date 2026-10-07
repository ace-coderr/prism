import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatEther, type Address, type Hex } from 'viem';
import { simulateContract } from 'wagmi/actions';
import { claimPath, linkState, prismGiftLinksAbi, type GiftLink } from '@prism/core';
import { giftLinksContract, sweepKey, useGiftLinks, useSavedLinks } from '../data/giftLinks';
import { useNow } from '../data/gifts';
import { OwnerChip, useCrystalShapes, useProfiles } from '../data/profiles';
import { giftLinkUrl } from '../data/share';
import { testnetClient } from '../data/chain';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { StepList, useTxSteps } from '../wallet/steps';
import { CrystalThumb } from './CrystalThumb';
import { SectionLabel } from './design';

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** The sender's gift links: where each one stands, the link again (if this browser has its key), and cancel. */
export function MyGiftLinks({ owner }: { owner: Address }) {
  const all = useGiftLinks();
  const saved = useSavedLinks(owner);
  const now = useNow();
  const mine = (all.data ?? []).filter((l) => l.sender.toLowerCase() === owner.toLowerCase()).reverse();
  const recipients = useProfiles(mine.flatMap((l) => (l.claimedBy ? [l.claimedBy] : [])));
  if (!giftLinksContract() || mine.length === 0) return null;
  return (
    <section aria-labelledby="my-gift-links" className="flex flex-col gap-4">
      <SectionLabel>
        <span id="my-gift-links">My gift links</span>
      </SectionLabel>
      <ul className="grid gap-4 md:grid-cols-2">
        {mine.map((l) => (
          <LinkRow key={l.id.toString()} link={l} owner={owner} now={now} keyHex={saved.keyOf(l.id)} recipient={l.claimedBy ? recipients.get(l.claimedBy.toLowerCase()) : undefined} />
        ))}
      </ul>
    </section>
  );
}

function LinkRow({
  link,
  owner,
  now,
  keyHex,
  recipient,
}: {
  link: GiftLink;
  owner: Address;
  now: number;
  keyHex: Hex | null;
  recipient?: Parameters<typeof OwnerChip>[0]['profile'];
}) {
  const shape = useCrystalShapes().get(link.crystalId);
  const state = linkState(link, now);
  const tx = useTxSteps();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [refund, setRefund] = useState<string | null>(null);
  const contract = giftLinksContract()!;

  const copy = async () => {
    if (!keyHex) return;
    try {
      await navigator.clipboard.writeText(giftLinkUrl(claimPath(link.id, keyHex)));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const cancel = async () => {
    const ok = await tx.run([
      {
        label: `Taking crystal #${link.crystalId} back`,
        tx: {
          description: `Cancel the gift link and take crystal #${link.crystalId} back. The link stops working.`,
          action: 'Cancel gift link',
          contract: 'PrismGiftLinks',
        },
        send: async (write) => {
          const { request } = await simulateContract(wagmiConfig, {
            address: contract.address,
            abi: prismGiftLinksAbi,
            functionName: 'cancel',
            args: [link.id],
            chainId: TARGET_CHAIN.id,
            account: owner,
          });
          return write(request);
        },
      },
    ]);
    if (!ok) return;
    // the gas money on the link's key comes back too (signed by the key: no wallet prompt)
    if (keyHex) {
      try {
        const before = await testnetClient.getBalance({ address: owner });
        const h = await sweepKey(keyHex, owner);
        if (h) {
          await testnetClient.waitForTransactionReceipt({ hash: h });
          const back = (await testnetClient.getBalance({ address: owner })) - before;
          if (back > 0n) setRefund(Number(formatEther(back)).toLocaleString('en-US', { maximumSignificantDigits: 3 }));
        }
      } catch {
        /* nothing to return, or the RPC hiccupped: the crystal is back either way */
      }
    }
    void queryClient.invalidateQueries({ queryKey: ['gift-links'] });
    void queryClient.invalidateQueries({ queryKey: ['balance'] });
    void queryClient.invalidateQueries({ queryKey: ['crystal-events'] });
    void queryClient.invalidateQueries({ queryKey: ['all-crystals'] });
    void queryClient.invalidateQueries({ queryKey: ['my-crystals'] });
  };

  const status =
    state === 'claimed' ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        Claimed by <OwnerChip address={link.claimedBy!} profile={recipient} size={16} className="text-white" />
      </span>
    ) : state === 'cancelled' ? (
      'Cancelled: back with you'
    ) : state === 'expired' ? (
      `Expired ${fmtDate(link.expiry)}: take it back`
    ) : (
      `Waiting · until ${fmtDate(link.expiry)}`
    );
  const tone = state === 'claimed' ? 'text-lime' : state === 'waiting' ? 'text-white' : 'text-mist';
  return (
    <li className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-4">
        <span className="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-2xl bg-ink">
          {shape && <CrystalThumb holdings={shape.holdings} history={shape.history} sealed={state === 'waiting' || state === 'expired'} size={50} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold">
            Crystal #{link.crystalId.toString()} <span className="font-mono text-xs font-normal text-mist">link #{link.id.toString()}</span>
          </p>
          <p className={`mt-1 text-sm ${tone}`}>{status}</p>
          {link.note && <p className="mt-1 truncate text-xs text-mist">“{link.note}”</p>}
        </div>
      </div>
      {(state === 'waiting' || state === 'expired') && (
        <div className="flex flex-wrap items-center gap-2">
          {state === 'waiting' && keyHex && (
            <button type="button" className="btn btn-outline !px-4 !py-2" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          )}
          <button type="button" className="btn btn-outline !px-4 !py-2" disabled={tx.running} onClick={() => void cancel()}>
            {tx.running ? 'Working…' : 'Cancel & take it back'}
          </button>
        </div>
      )}
      {state === 'waiting' && !keyHex && <p className="text-xs text-mist">This link was made in another browser: copy it from there.</p>}
      <StepList steps={tx.steps} />
      {refund && <p className="text-xs text-lime">+ {refund} test ETH gas money back to you.</p>}
    </li>
  );
}
