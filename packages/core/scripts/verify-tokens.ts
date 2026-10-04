/**
 * Read-only verification of token candidates on Robinhood Chain Testnet (46630).
 * No transactions, no keys — only eth_call / eth_getCode.
 *
 *   npx tsx packages/core/scripts/verify-tokens.ts [rhj-assets.json] [chainlink-feeds.json]
 *
 * The optional JSON files (downloaded from https://api.robinhood.com/rhj/assets and
 * https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json) are used
 * only to PROBE whether mainnet addresses also exist on testnet; they are reported,
 * never added to tokens.ts automatically.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, erc20Abi, getAddress, http, type Address } from 'viem';
import { robinhoodChainTestnet } from '../src/chain';

const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { batch: true }),
});

// Candidates whose docs/config explicitly place them on chain 46630.
const CANDIDATES: Array<{ address: string; label: string; sourceUrl: string }> = [
  {
    address: '0x7943e237c7F95DA44E0301572D358911207852Fa',
    label: 'L2 WETH (testnet column)',
    sourceUrl: 'https://docs.robinhood.com/chain/protocol-contracts',
  },
  {
    address: '0x5a5398155d98374c0e26265ea3cb9818169c2739',
    label: 'vibe/vibe quote asset SPCX',
    sourceUrl: 'https://testnet.vibevibe.fun/api/v1/chains/46630/config',
  },
  {
    address: '0x728E721256D0708D23b00afCD32c096979259b16',
    label: 'vibe/vibe canonical asset',
    sourceUrl: 'https://testnet.vibevibe.fun/api/v1/chains/46630/config',
  },
];

const aggregatorAbi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

async function readErc20(address: Address) {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'totalSupply' }),
  ]);
  return { name, symbol, decimals, totalSupply: totalSupply.toString() };
}

async function hasCode(address: Address) {
  const code = await client.getCode({ address });
  return !!code && code !== '0x';
}

async function main() {
  const chainId = await client.getChainId();
  const block = await client.getBlockNumber();
  console.log(`# chainId ${chainId}, block ${block}`);
  if (chainId !== 46630) throw new Error('not Robinhood Chain Testnet');

  console.log('\n## Documented testnet candidates');
  for (const c of CANDIDATES) {
    const address = getAddress(c.address);
    try {
      const t = await readErc20(address);
      console.log(JSON.stringify({ ok: true, ...c, address, ...t }));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, ...c, address, error: (e as Error).message.split('\n')[0] }));
    }
  }

  const [assetsFile, feedsFile] = process.argv.slice(2);
  if (assetsFile) {
    const assets = JSON.parse(readFileSync(assetsFile, 'utf8')).assets as Array<{
      tokenSymbol: string;
      deployments: Array<{ contractAddress: string; chainId: number }>;
    }>;
    console.log(`\n## Probe: do the ${assets.length} mainnet (4663) stock-token addresses have code on testnet?`);
    let found = 0;
    for (const a of assets) {
      for (const d of a.deployments) {
        const address = getAddress(d.contractAddress);
        if (await hasCode(address)) {
          found++;
          let info: unknown = null;
          try {
            info = await readErc20(address);
          } catch {
            /* not an ERC-20 here */
          }
          console.log(JSON.stringify({ symbol: a.tokenSymbol, address, onTestnet: info }));
        }
      }
    }
    console.log(`found ${found} with code on testnet`);
  }

  if (feedsFile) {
    const feeds = JSON.parse(readFileSync(feedsFile, 'utf8')) as Array<{ name: string; proxyAddress?: string }>;
    console.log(`\n## Probe: do the ${feeds.length} mainnet Chainlink feed proxies exist on testnet?`);
    let found = 0;
    for (const f of feeds) {
      if (!f.proxyAddress) continue;
      const address = getAddress(f.proxyAddress);
      if (await hasCode(address)) {
        found++;
        let round: unknown = null;
        try {
          const r = await client.readContract({ address, abi: aggregatorAbi, functionName: 'latestRoundData' });
          round = { answer: r[1].toString(), updatedAt: r[3].toString() };
        } catch {
          /* not a feed here */
        }
        console.log(JSON.stringify({ feed: f.name, address, round }));
      }
    }
    console.log(`found ${found} with code on testnet`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
