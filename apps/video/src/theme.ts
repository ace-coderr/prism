import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

/** PRISM palette (same as the web app). */
export const C = {
  ink: '#101214',
  panel: '#16191c',
  line: '#262b30',
  mist: '#9aa2a9',
  lime: '#d4f000',
  up: '#4cd07a',
  down: '#f0544f',
  gold: '#f6c143',
  frost: '#d6f1ff',
  white: '#f2f3f0',
} as const;

export const DISPLAY = 'PRISM Grotesk';
export const MONO = 'PRISM Mono';

/** Space Grotesk Bold + Space Mono (SIL OFL), bundled in public/fonts. */
export const fontsReady = Promise.all([
  loadFont({ family: DISPLAY, url: staticFile('fonts/SpaceGrotesk-Bold.ttf'), weight: '700' }),
  loadFont({ family: MONO, url: staticFile('fonts/SpaceMono-Regular.ttf'), weight: '400' }),
  loadFont({ family: MONO, url: staticFile('fonts/SpaceMono-Bold.ttf'), weight: '700' }),
]);

/** One official vibe viber, loaded as-is from vibe/vibe's site (featured with permission). */
export const VIBER_URL = 'https://testnet.vibevibe.fun/vibers/collection/viber-10-480.webp';
