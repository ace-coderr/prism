import { usePrivy } from '@privy-io/react-auth';
import { PRIVY_APP_ID } from './config';

/** Opening the login from page content (e.g. "Claim with email or wallet"). */
export interface SignIn {
  /** false without Privy (browser wallets only: show the WalletButton instead) */
  available: boolean;
  ready: boolean;
  signIn: () => void;
}

function usePrivySignIn(): SignIn {
  const { ready, login } = usePrivy();
  return { available: true, ready, signIn: () => login() };
}

function useNoSignIn(): SignIn {
  return { available: false, ready: true, signIn: () => {} };
}

/** Chosen once: Privy's login when its app ID is set. */
export const useSignIn: () => SignIn = PRIVY_APP_ID ? usePrivySignIn : useNoSignIn;
