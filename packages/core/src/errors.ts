/**
 * Readable errors: wallet / RPC failures and every PRISM contract custom error, decoded
 * with their arguments so the app can say what happened in plain words instead of "reverted".
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  decodeErrorResult,
  formatUnits,
  parseAbi,
  toFunctionSelector,
  type Abi,
  type Hex,
} from 'viem';
import { prismProfilesAbi } from './abi/prismProfiles';
import { prismReviewsAbi } from './abi/prismReviews';

/** What the app knows that the error itself doesn't carry. */
export interface ErrorContext {
  /** The token the action is about, as people know it ("BULO"). */
  symbol?: string;
}

type Args = readonly unknown[];
type AbiError = Extract<Abi[number], { type: 'error' }>;
type Explain = string | ((args: Args, ctx: ErrorContext) => string);

/** A token amount for a sentence: up to 4 significant digits ("0.01767", "12.35"). */
export function formatAmount(v: bigint, decimals = 18): string {
  const n = Number(formatUnits(v, decimals));
  return n === 0 ? '0' : n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

const MESSAGES: Record<string, Explain> = {
  // ---------------------------------------------------------------- shared
  ZeroAddress: 'Invalid address.',
  // ---------------------------------------------------------------- tokens (OpenZeppelin ERC-20)
  ERC20InsufficientBalance: 'Not enough tokens in your wallet.',
  ERC20InsufficientAllowance: 'Token approval is too low: approve again.',
  // ---------------------------------------------------------------- PrismProfiles
  InvalidName: 'Usernames are 3–20 characters: lowercase letters, numbers and _.',
  NameTaken: 'Someone else just took that username. Try another.',
  AlreadyYours: 'That username is already yours.',
  NoName: 'You don’t have a username to remove.',
  NoAvatar: 'You don’t have an avatar to remove.',
  NotCrystalOwner: 'Only the crystal’s current owner can use it as an avatar.',
  InvalidBio: 'Bios are one line of up to 120 bytes.',
  NoBio: 'You don’t have a bio to remove.',
  InvalidX: 'X handles are up to 15 letters, numbers or _ (no @, no link).',
  NoX: 'You don’t have an X handle to remove.',
  AddressEmptyCode: 'That address has no contract code.',
  FailedCall: 'A call inside the contract failed.',
  // ---------------------------------------------------------------- PrismReviews
  InvalidRating: 'Pick a rating from 1 to 5 stars.',
  TextTooLong: ([length]) =>
    `Reviews are up to 280 bytes${typeof length === 'bigint' ? ` (this one is ${length}; emoji and accents count double or more)` : ''}.`,
  NotAToken: 'That address isn’t a token PRISM can check.',
  NotHolder: (_, ctx) => `Only holders can review: you don’t hold any ${ctx.symbol ?? 'of this token'} right now.`,
  TooSoon: ([at]) =>
    typeof at === 'bigint'
      ? `You reviewed this token less than an hour ago. You can post again after ${new Date(Number(at) * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`
      : 'You reviewed this token less than an hour ago. Try again later.',
  UnknownReview: 'That review doesn’t exist.',
  NotActive: 'That review was already replaced or marked SOLD.',
  StillHolding: 'The reviewer still holds at least half of the most they’ve held since their first review, so it can’t be marked SOLD.',
  InvalidFirstId: 'The first review id must be 1 or more.',
};

/** Standard errors the PRISM contracts can bubble up from the tokens they move. */
const tokenErrorsAbi = parseAbi([
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
]);

const selectorOf = (item: AbiError) => toFunctionSelector(`${item.name}(${item.inputs.map((i) => i.type).join(',')})`);

let errorsAbi: AbiError[] | null = null;
/** Every custom error the app can meet, once per selector. */
export function prismErrorsAbi(): AbiError[] {
  if (!errorsAbi) {
    const seen = new Set<string>();
    errorsAbi = [];
    for (const abi of [prismReviewsAbi, prismProfilesAbi, tokenErrorsAbi] as Abi[]) {
      for (const item of abi) {
        if (item.type !== 'error') continue;
        const selector = selectorOf(item);
        if (seen.has(selector)) continue;
        seen.add(selector);
        errorsAbi.push(item);
      }
    }
  }
  return errorsAbi;
}

let errorNames: Map<string, string> | null = null;
/**
 * A PRISM contract error's name from its 4-byte selector. Some nodes hand back only the
 * selector (no revert data), and then viem can't decode it by itself.
 */
export function errorNameOf(selector: string): string | null {
  if (!errorNames) {
    errorNames = new Map();
    for (const item of prismErrorsAbi()) {
      errorNames.set(selectorOf(item), item.name);
    }
  }
  return errorNames.get(selector.slice(0, 10).toLowerCase()) ?? null;
}

/** The plain sentence for a contract error, by name (with its arguments when known). */
export function revertMessage(errorName: string, args: Args = [], ctx: ErrorContext = {}): string | null {
  const m = MESSAGES[errorName];
  if (m === undefined) return null;
  return typeof m === 'string' ? m : m(args, ctx);
}

/** Every error name that has a plain sentence (tests check that no contract error is missing). */
export const explainedErrors = () => Object.keys(MESSAGES);

/** Revert data → one sentence. Handles PRISM errors, Error(string), Panic and unknown selectors. */
export function messageForRevertData(data: Hex | undefined, ctx: ErrorContext = {}): string {
  if (!data || data === '0x') return 'The contract refused this without giving a reason.';
  try {
    const { errorName, args = [] } = decodeErrorResult({ abi: prismErrorsAbi(), data });
    if (errorName === 'Error') return `The contract refused: ${String(args[0])}`;
    if (errorName === 'Panic') return `The contract hit an internal error (panic ${String(args[0])}).`;
    const m = revertMessage(errorName, args, ctx);
    if (m) return m;
  } catch {
    // selector only, or an error that isn't ours
    const name = errorNameOf(data);
    const m = name ? revertMessage(name, [], ctx) : null;
    if (m) return m;
  }
  return `The contract refused this (error ${data.slice(0, 10)}).`;
}

/** The raw revert data inside any viem / RPC error, if there is some. */
export function revertDataOf(err: unknown): Hex | undefined {
  let e: unknown = err;
  for (let depth = 0; e && depth < 12; depth++) {
    if (e instanceof ContractFunctionRevertedError && e.raw) return e.raw;
    const data = (e as { data?: unknown }).data;
    if (typeof data === 'string' && /^0x[0-9a-fA-F]*$/.test(data)) return data as Hex;
    if (data && typeof data === 'object' && typeof (data as { data?: unknown }).data === 'string') return (data as { data: Hex }).data;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Turn any wallet / RPC / revert error into one readable sentence. */
export function friendlyError(err: unknown, ctx: ErrorContext = {}): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return 'You rejected the request in your wallet.';
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const decoded = revert.data;
      if (decoded && decoded.errorName !== 'Error' && decoded.errorName !== 'Panic') {
        const m = revertMessage(decoded.errorName, decoded.args ?? [], ctx);
        if (m) return m;
      }
      if (revert.reason) return `The contract refused: ${revert.reason}`;
      // not in the ABI the call was made with (e.g. writeContract's one-function ABI): decode it ourselves
      const raw = revert.raw ?? revert.signature;
      if (raw && raw !== '0x') return messageForRevertData(raw, ctx);
      return messageForRevertData(revertDataOf(err), ctx);
    }
    const text = `${err.shortMessage} ${err.details ?? ''}`.toLowerCase();
    if (text.includes('insufficient funds')) return 'Not enough ETH in your wallet to pay for this (including gas).';
    if (text.includes('user rejected') || text.includes('user denied')) return 'You rejected the request in your wallet.';
    if (text.includes('chain mismatch') || text.includes('does not match the target chain'))
      return 'Your wallet is on the wrong network — switch to Robinhood Chain Testnet.';
    if (text.includes('execution reverted')) {
      const data = revertDataOf(err);
      if (data) return messageForRevertData(data, ctx);
    }
    return err.shortMessage;
  }
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes('user rejected') || m.includes('user denied')) return 'You rejected the request in your wallet.';
    return err.message.split('\n')[0]!;
  }
  return 'Something went wrong.';
}
