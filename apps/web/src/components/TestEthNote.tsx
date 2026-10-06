import { useState } from 'react';
import { useBalance } from 'wagmi';
import { FAUCET_URL, needsTestEth } from '../wallet/account';
import { TARGET_CHAIN } from '../wallet/config';
import { useWallet } from '../wallet/WalletButton';
import { GuideNote } from './Viber';

const KEY = 'prism.test-eth-note.later';

function laterSet(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Right after logging in, a new wallet (an embedded one especially) has 0 test ETH and
 * nothing on PRISM works yet: point to the faucet with the address to paste. Goes away by
 * itself once ETH arrives; "Later" hides it for this browser session.
 */
export function TestEthNote({ className = '' }: { className?: string }) {
  const { address, isConnected, onTarget } = useWallet();
  const balance = useBalance({ address, chainId: TARGET_CHAIN.id, query: { enabled: !!address, refetchInterval: 15_000 } });
  const [later, setLater] = useState(laterSet);
  const [copied, setCopied] = useState(false);
  if (!isConnected || !onTarget || !address || !needsTestEth(balance.data?.value) || later.has(address.toLowerCase())) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the address is right there to select */
    }
  };
  const hide = () => {
    const next = new Set(later).add(address.toLowerCase());
    setLater(next);
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* storage blocked: hidden until the page reloads */
    }
  };
  return (
    <div role="status" className={className}>
      <GuideNote
        index={1}
        action={
          <>
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="btn btn-primary">
              Get test ETH ↗
            </a>
            <button type="button" className="btn btn-outline" onClick={hide}>
              Later
            </button>
          </>
        }
      >
        <b className="font-display text-white">You need a little test ETH to start.</b> It’s free and has no real value. Paste your address into
        the Robinhood Chain faucet:
        <span className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-ink px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-lime">{address}</code>
          <button type="button" onClick={copy} className="chip shrink-0" aria-label="Copy your address">
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </span>
      </GuideNote>
    </div>
  );
}
