import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatEther, type Address } from 'viem';
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { explorerAddressUrl, friendlyError } from '@prism/core';
import { TARGET_CHAIN } from './config';
import { AssetDots } from '../components/AssetDots';
import { useProfileEditor } from '../components/editorContext';
import { Avatar, useCrystalShapes, useProfile } from '../data/profiles';

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Connected + on Robinhood Chain Testnet. */
export function useWallet() {
  const { address, chainId, isConnected } = useAccount();
  return { address, isConnected, onTarget: isConnected && chainId === TARGET_CHAIN.id, wrongChain: isConnected && chainId !== TARGET_CHAIN.id };
}

/** Full-width "switch network" action for page content (forms, deploy page). */
export function SwitchNetworkButton({ className = '' }: { className?: string }) {
  const { switchChain, isPending, error } = useSwitchChain();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        className={`btn btn-primary ${className}`}
        disabled={isPending}
        // wagmi asks the wallet to add chain 46630 (RPC + explorer from config) if it doesn't know it
        onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}
      >
        {isPending ? 'Check your wallet…' : 'Switch to Robinhood Chain Testnet'}
      </button>
      {error && <span className="text-xs text-down">{friendlyError(error)}</span>}
    </span>
  );
}

const PILL =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-mono font-bold uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-60';
const SIZE = { nav: 'h-9 px-4 text-[11px]', hero: 'h-11 px-6 text-xs' } as const;
const MENU = 'absolute z-50 mt-2 rounded-2xl border border-white/10 bg-panel p-2 text-sm shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]';
const ITEM = 'block w-full rounded-xl px-3 py-2 text-left text-mist hover:bg-white/5 hover:text-white';

/** Closes a popover when clicking outside `ref` or pressing Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/** Top of the wallet menu: the avatar crystal bigger, with the key to its colours (too small to read in the pill). */
function AvatarKey({ address, avatarId }: { address: Address; avatarId: bigint }) {
  const shape = useCrystalShapes().get(avatarId);
  if (!shape) return null;
  return (
    <div className="mb-1 flex items-center gap-3 border-b border-white/[0.06] px-3 pb-3 pt-2">
      <Avatar address={address} avatarId={avatarId} size={44} />
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist" title={`Your avatar is crystal #${avatarId}`}>
          Avatar · #{avatarId.toString()}
        </p>
        <AssetDots holdings={shape.holdings} sealed={shape.sealed} className="mt-2" />
      </div>
    </div>
  );
}

/**
 * The one pill CTA: lime CONNECT → dark lime-bordered address pill (with copy /
 * explorer / disconnect) → amber SWITCH NETWORK when on the wrong chain.
 * `variant="hero"` is the larger version used in the Home call-to-action.
 */
export function WalletButton({ variant = 'nav' }: { variant?: 'nav' | 'hero' }) {
  const { address, isConnected, wrongChain } = useWallet();
  const { connectors: all, connect, isPending, error } = useConnect();
  // EIP-6963 wallets (MetaMask, Rabby, …) list themselves; hide the generic entry when any exist
  const named = all.filter((c) => c.id !== 'injected');
  const connectors = named.length > 0 ? named : all;
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const balance = useBalance({ address, chainId: TARGET_CHAIN.id, query: { enabled: !!address, refetchInterval: 15_000 } });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { profile } = useProfile(address);
  const name = profile.name;
  const editor = useProfileEditor();
  const ref = useDismiss(open, () => setOpen(false));
  const size = SIZE[variant];
  const align = variant === 'hero' ? 'left-1/2 -translate-x-1/2' : 'right-0';

  if (isConnected && wrongChain) {
    return (
      <div className="relative">
        <button
          className={`${PILL} ${size} bg-amber-400 text-ink hover:bg-amber-300`}
          disabled={switching}
          title="Switch your wallet to Robinhood Chain Testnet (chain 46630)"
          // wagmi asks the wallet to add chain 46630 (RPC + explorer from config) if it doesn't know it
          onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}
        >
          {switching ? 'Check wallet…' : 'Switch network'}
        </button>
        {switchError && <p className={`${MENU} ${align} w-64 text-xs text-down`}>{friendlyError(switchError)}</p>}
      </div>
    );
  }

  if (isConnected && address) {
    const eth = balance.data ? Number(formatEther(balance.data.value)) : null;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard blocked — the address is still visible in the title */
      }
    };
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className={`${PILL} ${size} border border-lime/70 bg-ink text-white hover:border-lime`}
          title={address}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar address={address} avatarId={profile.avatarId} size={variant === 'hero' ? 26 : 22} className="-ml-2" />
          <span className="normal-case tracking-[0.06em]">{name ? `@${name}` : shortAddress(address)}</span>
          <span className={`text-mist ${variant === 'hero' ? '' : 'hidden md:inline'}`}>
            {eth === null ? '…' : `${eth < 0.0001 && eth > 0 ? '<0.0001' : eth.toFixed(4)} ETH`}
          </span>
        </button>
        {open && (
          <div role="menu" className={`${MENU} ${align} w-60`}>
            {profile.avatarId !== null && <AvatarKey address={address} avatarId={profile.avatarId} />}
            <Link role="menuitem" to="/profile" className={ITEM} onClick={() => setOpen(false)}>
              My profile
            </Link>
            <button
              role="menuitem"
              className={`${ITEM} disabled:cursor-not-allowed disabled:text-mist/40 disabled:hover:bg-transparent`}
              disabled={!editor.available}
              title={editor.available ? undefined : 'Profiles turn on once their contract is deployed'}
              onClick={() => {
                setOpen(false);
                editor.open();
              }}
            >
              Edit profile
              {!editor.available && <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-300/80">soon</span>}
            </button>
            <div className="my-1 border-t border-white/[0.06]" />
            <button role="menuitem" className="block w-full rounded-xl px-3 py-2 text-left text-mist hover:bg-white/5 hover:text-white" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy address'}
            </button>
            <a role="menuitem" className="block rounded-xl px-3 py-2 text-mist hover:bg-white/5 hover:text-white" href={explorerAddressUrl(address)} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
            <button
              role="menuitem"
              className="block w-full rounded-xl px-3 py-2 text-left text-mist hover:bg-white/5 hover:text-white"
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className={`${PILL} ${size} ${
          variant === 'hero'
            ? 'border border-lime/70 bg-ink text-lime hover:bg-lime/10'
            : 'bg-lime text-ink hover:shadow-[0_0_24px_rgba(212,240,0,0.35)]'
        }`}
        disabled={isPending}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {isPending ? 'Check wallet…' : variant === 'hero' ? 'Connect wallet' : 'Connect'}
      </button>
      {open && (
        <div role="menu" className={`${MENU} ${align} w-64`}>
          {connectors.length === 0 && <p className="px-3 py-2 text-mist">No browser wallet found. Install MetaMask or Rabby.</p>}
          {connectors.map((c) => (
            <button
              key={c.uid}
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-white/5"
              onClick={() => {
                setOpen(false);
                connect({ connector: c, chainId: TARGET_CHAIN.id });
              }}
            >
              {c.icon ? <img src={c.icon} alt="" className="h-5 w-5" /> : <span className="h-5 w-5 rounded bg-white/10" />}
              {c.name === 'Injected' ? 'Browser wallet' : c.name}
            </button>
          ))}
          <p className="px-3 pt-1 text-[11px] text-mist/70">Testnet only. PRISM never asks for your seed phrase or keys.</p>
        </div>
      )}
      {error && <p className={`${MENU} ${align} w-64 text-xs text-down`}>{friendlyError(error)}</p>}
    </div>
  );
}
