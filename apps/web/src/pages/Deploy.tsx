import { useState } from 'react';
import type { Address } from 'viem';
import { deployContract } from 'wagmi/actions';
import { explorerAddressUrl, getDeployment, prismCrystalAbi, prismCrystalBytecode } from '@prism/core';
import { Panel } from '../components/ui';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { StepList, useTxSteps } from '../wallet/steps';
import { WalletButton, useWallet } from '../wallet/WalletButton';

/**
 * Hidden route (not in the nav): deploys the compiled PrismCrystal from the connected
 * browser wallet. No keys ever touch PRISM.
 */
export default function Deploy() {
  const { address, isConnected, onTarget } = useWallet();
  const { steps, running, run } = useTxSteps();
  const [deployed, setDeployed] = useState<{ address: Address; block: bigint } | null>(null);
  const existing = getDeployment(TARGET_CHAIN.id);

  const deploy = () =>
    run([
      {
        label: 'Deploy PrismCrystal',
        send: () =>
          deployContract(wagmiConfig, {
            abi: prismCrystalAbi,
            bytecode: prismCrystalBytecode,
            chainId: TARGET_CHAIN.id,
          }),
        after: (r) => r.contractAddress && setDeployed({ address: r.contractAddress, block: r.blockNumber }),
      },
    ]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-4">
      <h1 className="headline text-3xl">Deploy PrismCrystal</h1>
      <p className="text-sm text-mist">
        Deploys the tested (but not audited) PrismCrystal contract to <b className="text-white">Robinhood Chain Testnet</b> from
        your own wallet. No owner, no admin, no fees, no upgrades. Deploy it <b className="text-white">once</b>.
      </p>

      {existing && (
        <Panel className="border-lime/40 p-4 text-sm">
          Already deployed at{' '}
          <a className="font-mono text-lime" href={explorerAddressUrl(existing.prismCrystal)} target="_blank" rel="noreferrer">
            {existing.prismCrystal} ↗
          </a>
          . You don’t need to deploy again.
        </Panel>
      )}

      <Panel className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="label text-mist">1 · Wallet</span>
          <WalletButton />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="label text-mist">2 · Deploy</span>
          <button className="btn btn-primary" disabled={!onTarget || running || !!deployed} onClick={deploy}>
            {running ? 'Deploying…' : deployed ? 'Deployed' : 'Deploy contract'}
          </button>
          {!isConnected && <span className="text-xs text-mist">Connect a wallet first.</span>}
          {isConnected && !onTarget && <span className="text-xs text-mist">Switch to Robinhood Chain Testnet first.</span>}
        </div>
        <p className="text-xs text-mist/80">
          Your wallet will show a contract-creation transaction of roughly 4.5M gas. On testnet that costs a small amount of
          test ETH. Deployer: {address ?? '—'}
        </p>
        <StepList steps={steps} />
      </Panel>

      {deployed && (
        <Panel className="space-y-2 border-lime/50 p-4">
          <p className="label text-lime">Deployed</p>
          <p className="break-all font-mono text-sm text-white">{deployed.address}</p>
          <p className="text-xs text-mist">Block {deployed.block.toString()}</p>
          <div className="flex flex-wrap gap-3 pt-1">
            <a className="btn btn-secondary" href={explorerAddressUrl(deployed.address)} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
            <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(`${deployed.address} (block ${deployed.block})`)}>
              Copy address
            </button>
          </div>
          <p className="pt-2 text-sm">
            <b>Next:</b> paste this address (and block number) back to Claude in chat. It will be saved in{' '}
            <code className="font-mono text-lime">packages/core/src/deployments.ts</code> and the source verified on the explorer.
          </p>
        </Panel>
      )}
    </div>
  );
}
