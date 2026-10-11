import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Abi, Address, Hex } from 'viem';
import { deployContract } from 'wagmi/actions';
import { explorerAddressUrl } from '@prism/core';
import { Panel } from '../components/ui';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { StepList, useTxSteps } from '../wallet/steps';
import { WalletButton, useWallet } from '../wallet/WalletButton';
import { PageScroll } from '../components/PageHeader';

/**
 * Hidden route (dev server only, not in the nav): deploys PRISM contracts from the connected
 * browser wallet. No key ever touches PRISM. The crystal app's contracts (legacy) are no
 * longer deployable from here; their source is archived at the crystal-v1 tag.
 */
export default function Deploy() {
  return (
    <PageScroll className="max-w-2xl gap-4">
      <h1 className="headline text-3xl">Deploy</h1>
      <p className="text-sm text-mist">
        Deploys PRISM contracts to <b className="text-white">Robinhood Chain Testnet</b> from your own wallet. Each one is deployed{' '}
        <b className="text-white">once</b>, then recorded in <code className="font-mono text-lime">packages/core/src/deployments.ts</code>.
      </p>
      <Panel className="flex flex-wrap items-center gap-3 p-4">
        <span className="label text-mist">Wallet</span>
        <WalletButton />
      </Panel>
      <Panel className="p-4 text-sm text-mist">No contract is waiting to be deployed.</Panel>
    </PageScroll>
  );
}

/** One contract: what it is, what's fixed at deploy, the button, then where to record it. */
export function DeploySection({
  name,
  about,
  fixed,
  existing,
  abi,
  bytecode,
  args = [],
  gas,
  record,
}: {
  name: string;
  about: ReactNode;
  /** constructor arguments in words, or null when there are none */
  fixed: ReactNode | null;
  /** already in deployments.ts: the button stays locked */
  existing?: Address;
  abi: Abi;
  bytecode: Hex;
  args?: readonly unknown[];
  /** "about 1.2M gas" */
  gas: string;
  /** lines to paste into deployments.ts */
  record: (d: { address: Address; block: bigint; tx: Hex }) => string;
}) {
  const { address, isConnected, onTarget } = useWallet();
  const { steps, running, run } = useTxSteps();
  const [deployed, setDeployed] = useState<{ address: Address; block: bigint; tx: Hex } | null>(null);
  const [copied, setCopied] = useState(false);

  const deploy = () =>
    !existing &&
    run([
      {
        label: `Deploy ${name}`,
        send: () => deployContract(wagmiConfig, { abi, bytecode, args, chainId: TARGET_CHAIN.id }),
        after: (r) => r.contractAddress && setDeployed({ address: r.contractAddress, block: r.blockNumber, tx: r.transactionHash }),
      },
    ]);
  const copy = async () => {
    if (!deployed) return;
    try {
      await navigator.clipboard.writeText(record(deployed));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the values are on screen */
    }
  };

  return (
    <>
      <h2 className="headline mt-10 text-2xl">Deploy {name}</h2>
      <div className="text-sm text-mist">{about}</div>
      {existing && (
        <Panel className="border-lime/40 p-4 text-sm">
          Already deployed at{' '}
          <a className="break-all font-mono text-lime" href={explorerAddressUrl(existing)} target="_blank" rel="noreferrer">
            {existing} ↗
          </a>
          .
        </Panel>
      )}
      <Panel className="space-y-4 p-4">
        <p className="label text-mist">Fixed at deploy (can never change)</p>
        <div className="font-mono text-[11px] text-white/90">{fixed ?? 'Nothing: no constructor arguments.'}</div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={!!existing || !onTarget || running || !!deployed} onClick={deploy}>
            {existing ? 'Already deployed' : running ? 'Deploying…' : deployed ? 'Deployed' : `Deploy ${name}`}
          </button>
          {!existing && !isConnected && <span className="text-xs text-mist">Connect a wallet first.</span>}
          {!existing && isConnected && !onTarget && <span className="text-xs text-mist">Switch to Robinhood Chain Testnet first.</span>}
        </div>
        <p className="text-xs text-mist/80">
          A contract-creation transaction of {gas} (a little test ETH). Deployer: {address ?? '—'}
        </p>
        <StepList steps={steps} />
      </Panel>
      {deployed && (
        <Panel className="space-y-2 border-lime/50 p-4">
          <p className="label text-lime">{name} deployed</p>
          <p className="break-all font-mono text-sm text-white">{deployed.address}</p>
          <p className="text-xs text-mist">
            Block {deployed.block.toString()} · tx <span className="break-all font-mono">{deployed.tx}</span>
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <a className="btn btn-secondary" href={explorerAddressUrl(deployed.address)} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
            <button className="btn btn-secondary" onClick={() => void copy()}>
              {copied ? 'Copied ✓' : 'Copy for deployments.ts'}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[11px] text-white/90">{record(deployed)}</pre>
          <p className="pt-2 text-sm">
            <b>Next:</b> paste these lines into <code className="font-mono text-lime">packages/core/src/deployments.ts</code> and verify the
            source on the explorer.
          </p>
        </Panel>
      )}
    </>
  );
}
