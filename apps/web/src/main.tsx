import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider as PrivyWagmiProvider } from '@privy-io/wagmi';
import App from './App';
import { PRIVY_APP_ID, PRIVY_CONFIG, wagmiConfig } from './wallet/config';
import './index.css';

const queryClient = new QueryClient();
const app = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

/** Privy (email, Google, X or a wallet; embedded wallets) when its app ID is set, else browser wallets only. */
function Wallets({ children }: { children: ReactNode }) {
  if (PRIVY_APP_ID) {
    return (
      <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={wagmiConfig}>{children}</PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    );
  }
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Wallets>{app}</Wallets>
  </StrictMode>,
);
