import { useEffect, useRef, useState } from 'react';
import { formatEther } from 'viem';
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { explorerAddressUrl, friendlyError } from '@prism/core';
import { TARGET_CHAIN } from './config';

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Connected + on Robinhood Chain Testnet. */
export function useWallet() {
  const { address, chainId, isConnected } = useAccount();
  return { address, isConnected, onTarget: isConnected && chainId === TARGET_CHAIN.id, wrongChain: isConnected && chainId !== TARGET_CHAIN.id };
}

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

/** Connect / account / wrong-network control. `big` = hero-sized button. */
export function WalletButton({ big = false }: { big?: boolean }) {
  const { address, isConnected, wrongChain } = useWallet();
  const { connectors: all, connect, isPending, error } = useConnect();
  // EIP-6963 wallets (MetaMask, Rabby, …) list themselves; hide the generic entry when any exist
  const named = all.filter((c) => c.id !== 'injected');
  const connectors = named.length > 0 ? named : all;
  const { disconnect } = useDisconnect();
  const balance = useBalance({ address, chainId: TARGET_CHAIN.id, query: { enabled: !!address, refetchInterval: 15_000 } });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (isConnected && wrongChain) return <SwitchNetworkButton className={big ? '' : '!px-3 !py-1.5 !text-[10px]'} />;

  if (isConnected && address) {
    const eth = balance.data ? Number(formatEther(balance.data.value)) : null;
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className={`btn btn-secondary ${big ? '' : '!px-3 !py-1.5 !text-[10px]'}`}
          title={address}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_#d4f000]" />
          {shortAddress(address)}
          <span className={`text-mist ${big ? '' : 'hidden sm:inline'}`}>
            {eth === null ? '…' : `${eth < 0.0001 && eth > 0 ? '<0.0001' : eth.toFixed(4)} ETH`}
          </span>
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-line bg-panel p-2 text-sm shadow-xl">
            <a className="block rounded px-2 py-1.5 text-mist hover:bg-white/5 hover:text-white" href={explorerAddressUrl(address)} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
            <button className="block w-full rounded px-2 py-1.5 text-left text-mist hover:bg-white/5 hover:text-white" onClick={() => disconnect()}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button className={`btn ${big ? 'btn-secondary' : 'btn-secondary !px-3 !py-1.5 !text-[10px]'}`} disabled={isPending} onClick={() => setOpen((o) => !o)}>
        {isPending ? (
          'Check your wallet…'
        ) : big ? (
          'Connect Wallet'
        ) : (
          <>
            {/* compact on phones so the nav links keep their room */}
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect Wallet</span>
          </>
        )}
      </button>
      {open && (
        <div className={`absolute z-50 mt-2 w-64 rounded-lg border border-line bg-panel p-2 text-sm shadow-xl ${big ? 'left-1/2 -translate-x-1/2' : 'right-0'}`}>
          {connectors.length === 0 && <p className="px-2 py-1.5 text-mist">No browser wallet found. Install MetaMask or Rabby.</p>}
          {connectors.map((c) => (
            <button
              key={c.uid}
              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/5"
              onClick={() => {
                setOpen(false);
                connect({ connector: c, chainId: TARGET_CHAIN.id });
              }}
            >
              {c.icon ? <img src={c.icon} alt="" className="h-5 w-5" /> : <span className="h-5 w-5 rounded bg-white/10" />}
              {c.name === 'Injected' ? 'Browser wallet' : c.name}
            </button>
          ))}
          <p className="px-2 pt-1 text-[11px] text-mist/70">Testnet only. PRISM never asks for your seed phrase or keys.</p>
        </div>
      )}
      {error && <p className="absolute mt-1 w-64 text-xs text-down">{friendlyError(error)}</p>}
    </div>
  );
}
