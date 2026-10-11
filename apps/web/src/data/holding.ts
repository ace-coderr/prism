import { useReadContracts } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { prismReviewsAbi } from '@prism/core';
import { reviewsContract } from '../components/reviews';
import { TARGET_CHAIN } from '../wallet/config';
import { useWallet } from '../wallet/WalletButton';

const STATUS = ['none', 'active', 'replaced', 'sold'] as const;

export interface MyReview {
  id: bigint;
  rating: number;
  status: (typeof STATUS)[number];
  postedAt: number;
  heldAtPost: bigint;
}

/**
 * The connected wallet and `token`, live from the chain: balance (the holder check), the token's
 * supply and decimals, and the wallet's current review of it on PrismReviews.
 */
export function useHolding(token: Address | undefined) {
  const { address, isConnected, onTarget } = useWallet();
  const contract = reviewsContract();
  const q = useReadContracts({
    contracts: [
      { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: TARGET_CHAIN.id },
      { address: token, abi: erc20Abi, functionName: 'totalSupply', chainId: TARGET_CHAIN.id },
      { address: token, abi: erc20Abi, functionName: 'decimals', chainId: TARGET_CHAIN.id },
      { address: contract, abi: prismReviewsAbi, functionName: 'reviewOf', args: [address!, token!], chainId: TARGET_CHAIN.id },
    ],
    query: { enabled: !!token && !!address, refetchInterval: 20_000 },
  });
  const [bal, supply, decimals, review] = q.data ?? [];
  const balance = bal?.status === 'success' ? (bal.result as bigint) : null;
  const mine = review?.status === 'success' ? (review.result as readonly [bigint, { rating: number; status: number; postedAt: number; heldAtPost: bigint }]) : null;
  const myReview: MyReview | null =
    mine && mine[0] > 0n
      ? { id: mine[0], rating: Number(mine[1].rating), status: STATUS[Number(mine[1].status)] ?? 'none', postedAt: Number(mine[1].postedAt), heldAtPost: mine[1].heldAtPost }
      : null;
  return {
    address,
    isConnected,
    onTarget,
    loading: q.isLoading,
    error: q.isError,
    balance,
    holds: balance !== null && balance > 0n,
    supply: supply?.status === 'success' ? (supply.result as bigint) : null,
    decimals: decimals?.status === 'success' ? Number(decimals.result) : 18,
    myReview,
    refetch: q.refetch,
  };
}
