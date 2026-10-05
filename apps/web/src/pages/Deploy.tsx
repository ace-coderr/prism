import { useState } from 'react';
import type { Address } from 'viem';
import { deployContract } from 'wagmi/actions';
import {
  ROUTER_TOKENS,
  explorerAddressUrl,
  getDeployment,
  prismCrystalAbi,
  prismCrystalBytecode,
  prismForgeRouterAbi,
  prismForgeRouterBytecode,
  prismProfilesAbi,
  prismProfilesBytecode,
  routerDeployArgs,
} from '@prism/core';
import { Panel } from '../components/ui';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { StepList, useTxSteps } from '../wallet/steps';
import { WalletButton, useWallet } from '../wallet/WalletButton';
import { PageScroll } from '../components/PageHeader';

/**
 * Hidden route (not in the nav): deploys the compiled PrismCrystal from the connected
 * browser wallet. No keys ever touch PRISM.
 */
export default function Deploy() {
  const { address, isConnected, onTarget } = useWallet();
  const { steps, running, run } = useTxSteps();
  const [deployed, setDeployed] = useState<{ address: Address; block: bigint } | null>(null);
  const existing = getDeployment(TARGET_CHAIN.id);

  // PrismCrystal is deployed once: with an address in deployments.ts this can't run at all
  const deploy = () =>
    !existing &&
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
    <PageScroll className="max-w-2xl gap-4">
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
          <button className="btn btn-primary" disabled={!!existing || !onTarget || running || !!deployed} onClick={deploy}>
            {existing ? 'Already deployed' : running ? 'Deploying…' : deployed ? 'Deployed' : 'Deploy contract'}
          </button>
          {existing && <span className="text-xs text-mist">Locked: PrismCrystal is already in deployments.ts.</span>}
          {!existing && !isConnected && <span className="text-xs text-mist">Connect a wallet first.</span>}
          {!existing && isConnected && !onTarget && <span className="text-xs text-mist">Switch to Robinhood Chain Testnet first.</span>}
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

      <RouterDeploy />
      <ProfilesDeploy />
    </PageScroll>
  );
}

/** Deploys PrismForgeRouter (forge from ETH in one transaction) from the connected wallet. */
function RouterDeploy() {
  const { address, isConnected, onTarget } = useWallet();
  const { steps, running, run } = useTxSteps();
  const [deployed, setDeployed] = useState<{ address: Address; block: bigint } | null>(null);
  const existing = getDeployment(TARGET_CHAIN.id);
  const crystal = existing?.prismCrystal;
  const args = crystal ? routerDeployArgs(crystal) : null;

  const deploy = () =>
    args &&
    !existing?.forgeRouter &&
    run([
      {
        label: 'Deploy PrismForgeRouter',
        send: () =>
          deployContract(wagmiConfig, {
            abi: prismForgeRouterAbi,
            bytecode: prismForgeRouterBytecode,
            args: [args[0], args[1], args[2], args[3], args[4]],
            chainId: TARGET_CHAIN.id,
          }),
        after: (r) => r.contractAddress && setDeployed({ address: r.contractAddress, block: r.blockNumber }),
      },
    ]);

  return (
    <>
      <h2 className="headline mt-10 text-2xl">Deploy PrismForgeRouter</h2>
      <p className="text-sm text-mist">
        Lets people forge a crystal straight from ETH in <b className="text-white">one transaction</b>: it swaps ETH into the chosen
        test stocks through their Uniswap V4 pools, forges the crystal and hands it to them. No owner, no admin, no fees, no
        upgrades, and it holds nothing between transactions. Tested (unit + fork tests) but not audited.
      </p>
      {existing?.forgeRouter && (
        <Panel className="border-lime/40 p-4 text-sm">
          Already deployed at{' '}
          <a className="font-mono text-lime" href={explorerAddressUrl(existing.forgeRouter)} target="_blank" rel="noreferrer">
            {existing.forgeRouter} ↗
          </a>
          .
        </Panel>
      )}
      <Panel className="space-y-4 p-4">
        <p className="label text-mist">Fixed at deploy (can never change)</p>
        {args ? (
          <ul className="space-y-1 font-mono text-[11px] text-white/90">
            <li>PoolManager: {args[0]}</li>
            <li>PrismCrystal: {args[1]}</li>
            {ROUTER_TOKENS.map((t, i) => (
              <li key={t.id}>
                Token {i + 1} ({t.id}): {args[2][i]}
              </li>
            ))}
            <li>
              Pools: ETH-paired, fee {args[3]} (0.3%), tick spacing {args[4]}, no hooks
            </li>
          </ul>
        ) : (
          <p className="text-sm text-down">Deploy PrismCrystal first.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={!args || !onTarget || running || !!deployed || !!existing?.forgeRouter} onClick={deploy}>
            {existing?.forgeRouter ? 'Already deployed' : running ? 'Deploying…' : deployed ? 'Deployed' : 'Deploy router'}
          </button>
          {!isConnected && <span className="text-xs text-mist">Connect a wallet first.</span>}
          {isConnected && !onTarget && <span className="text-xs text-mist">Switch to Robinhood Chain Testnet first.</span>}
        </div>
        <p className="text-xs text-mist/80">
          A contract-creation transaction of roughly 2M gas (a little test ETH). Deployer: {address ?? '—'}
        </p>
        <StepList steps={steps} />
      </Panel>
      {deployed && (
        <Panel className="space-y-2 border-lime/50 p-4">
          <p className="label text-lime">Router deployed</p>
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
            <b>Next:</b> paste this address back to Claude in chat. It goes into <code className="font-mono text-lime">forgeRouter</code> in{' '}
            <code className="font-mono text-lime">packages/core/src/deployments.ts</code>, which switches on “Start with ETH”, and the
            source gets verified on the explorer.
          </p>
        </Panel>
      )}
    </>
  );
}

/** Deploys PrismProfiles (usernames, crystal avatars, bios, X handles) from the connected wallet. */
function ProfilesDeploy() {
  const { address, isConnected, onTarget } = useWallet();
  const { steps, running, run } = useTxSteps();
  const [deployed, setDeployed] = useState<{ address: Address; block: bigint } | null>(null);
  const d = getDeployment(TARGET_CHAIN.id);
  const crystal = d?.prismCrystal;
  const existing = d?.prismProfiles;

  const deploy = () =>
    crystal &&
    !existing &&
    run([
      {
        label: 'Deploy PrismProfiles',
        send: () => deployContract(wagmiConfig, { abi: prismProfilesAbi, bytecode: prismProfilesBytecode, args: [crystal], chainId: TARGET_CHAIN.id }),
        after: (r) => r.contractAddress && setDeployed({ address: r.contractAddress, block: r.blockNumber }),
      },
    ]);

  return (
    <>
      <h2 className="headline mt-10 text-2xl">Deploy PrismProfiles</h2>
      <p className="text-sm text-mist">
        Public profiles: a unique username (3–20 characters of a–z, 0–9 and _, first come first served), one of your crystals
        as avatar (only while you own it), a one-line bio and an X handle. No owner, no admin, no fees, no upgrades: only an
        address can change its own profile. Tested but not audited.
      </p>
      {existing && (
        <Panel className="border-lime/40 p-4 text-sm">
          Already deployed at{' '}
          <a className="font-mono text-lime" href={explorerAddressUrl(existing)} target="_blank" rel="noreferrer">
            {existing} ↗
          </a>
          .
        </Panel>
      )}
      <Panel className="space-y-4 p-4">
        <p className="label text-mist">Fixed at deploy (can never change)</p>
        {crystal ? (
          <p className="font-mono text-[11px] text-white/90">PrismCrystal (avatars come from here): {crystal}</p>
        ) : (
          <p className="text-sm text-down">Deploy PrismCrystal first.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={!crystal || !onTarget || running || !!deployed || !!existing} onClick={deploy}>
            {existing ? 'Already deployed' : running ? 'Deploying…' : deployed ? 'Deployed' : 'Deploy PrismProfiles'}
          </button>
          {!isConnected && <span className="text-xs text-mist">Connect a wallet first.</span>}
          {isConnected && !onTarget && <span className="text-xs text-mist">Switch to Robinhood Chain Testnet first.</span>}
        </div>
        <p className="text-xs text-mist/80">A contract-creation transaction of about 1.35M gas (a little test ETH). Deployer: {address ?? '—'}</p>
        <StepList steps={steps} />
      </Panel>
      {deployed && (
        <Panel className="space-y-2 border-lime/50 p-4">
          <p className="label text-lime">PrismProfiles deployed</p>
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
            <b>Next:</b> paste this address back to Claude in chat. It goes into <code className="font-mono text-lime">prismProfiles</code> in{' '}
            <code className="font-mono text-lime">packages/core/src/deployments.ts</code>, which switches on profiles (names, avatars, bios,
            Edit profile), and the source gets verified on the explorer.
          </p>
        </Panel>
      )}
    </>
  );
}
