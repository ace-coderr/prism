/**
 * Example content for empty states. Static data in the front-end bundle and nothing else:
 *
 * - never on chain, never posted to a contract, no wallet ever signs for it;
 * - shown only by the components in components/examples.tsx, and only where a section has nothing
 *   real in it (they are never mixed with real entries, and vanish when one real entry exists);
 * - fictional throughout: invented names and tickers, no real company, logo, person or wallet.
 *   The wallets are obvious placeholders (0x0000…0001), which are not valid addresses.
 *
 * Nothing here may reach anything that counts or is shared: scores, honesty rep, badges,
 * leaderboards, the gem, any count, the published index files, page meta, share images or any
 * server route. examples.test.ts holds all of that in place.
 *
 * The types are deliberately not assignable to the real ones (an id that is a string, no `author`
 * or `token` address, no numbers a real card needs), so an example can't be passed where a real
 * review, X-ray or creator card is expected: typeChecks.ts proves it at compile time.
 */

/** Marks something as an example, as a literal type: a real record can never have it. */
export interface Example {
  readonly isExample: true;
}

export type ExampleState =
  | { readonly kind: 'holding'; readonly days: number }
  | { readonly kind: 'trimmed'; readonly percent: number; readonly days: number }
  | { readonly kind: 'sold'; readonly days: number };

export interface ExampleReview extends Example {
  /** a string, so it can never be mistaken for a review id (a number, used in /r/<id> links) */
  readonly id: `example-${number}`;
  /** a placeholder, not an address */
  readonly wallet: `0x0000…000${number}`;
  readonly symbol: string;
  readonly name: string;
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly text: string;
  readonly state: ExampleState;
}

/** What an X-ray with a flag looks like: the flag, and the lines under it. */
export interface ExampleXray extends Example {
  readonly symbol: string;
  readonly name: string;
  readonly flag: string;
  readonly lines: readonly string[];
}

/** What a card in "creators selling their own launch" looks like. */
export interface ExampleCreatorSold extends Example {
  readonly symbol: string;
  readonly name: string;
  readonly text: string;
  readonly xray: ExampleXray;
}

export const EXAMPLE_REVIEWS: readonly ExampleReview[] = [
  {
    isExample: true,
    id: 'example-1',
    wallet: '0x0000…0001',
    symbol: 'EXMOON',
    name: 'Example Moon Cat',
    rating: 5,
    text: 'An example of a holder’s review. A real one says how long its author has held the token, and whether they still do.',
    state: { kind: 'holding', days: 14 },
  },
  {
    isExample: true,
    id: 'example-2',
    wallet: '0x0000…0002',
    symbol: 'EXPUP',
    name: 'Example Pup Coin',
    rating: 4,
    text: 'An example of a trimmed review: its author sold some of what they held, so the card says how much.',
    state: { kind: 'trimmed', percent: 40, days: 9 },
  },
  {
    isExample: true,
    id: 'example-3',
    wallet: '0x0000…0003',
    symbol: 'EXKITE',
    name: 'Example Kite Token',
    rating: 5,
    text: 'An example of a SOLD review: its author praised the token, then sold. On a real one, everyone can see that, for good.',
    state: { kind: 'sold', days: 3 },
  },
];

export const EXAMPLE_XRAY: ExampleXray = {
  isExample: true,
  symbol: 'EXDIP',
  name: 'Example Dip Coin',
  flag: 'Creator sold 80% of their bag',
  lines: [
    'The creator has sold 80% of the $EXDIP they bought (all in one sale) and still holds 20M.',
    'Of the 12 wallets holding $EXDIP, the top 3 hold 41% of the supply.',
  ],
};

/** Built from the example X-ray, so the card and the X-ray it comes from can't disagree. */
export const EXAMPLE_CREATOR_SOLD: ExampleCreatorSold = {
  isExample: true,
  symbol: EXAMPLE_XRAY.symbol,
  name: EXAMPLE_XRAY.name,
  text: 'The creator had sold 80% of the $EXDIP they bought (all in one sale) and held 20M.',
  xray: EXAMPLE_XRAY,
};

/** Everything an example could be matched against a real launch by: names and tickers. */
export const EXAMPLE_IDENTITIES: ReadonlyArray<{ symbol: string; name: string }> = [
  ...EXAMPLE_REVIEWS.map((r) => ({ symbol: r.symbol, name: r.name })),
  { symbol: EXAMPLE_XRAY.symbol, name: EXAMPLE_XRAY.name },
];
