import { useState } from 'react';
import type { Address } from 'viem';
import { useProfileEditor } from './editorContext';
import { useProfile } from '../data/profiles';

const key = (a: Address) => `prism.claim-username.dismissed.${a.toLowerCase()}`;

function wasDismissed(a: Address) {
  try {
    return window.localStorage.getItem(key(a)) === '1';
  } catch {
    return false;
  }
}

/**
 * "Claim your username" for a wallet that has crystals but no name yet. Dismissible
 * (remembered per address in this browser). Hidden until PrismProfiles is deployed.
 */
export function ClaimBanner({ address }: { address: Address }) {
  const editor = useProfileEditor();
  const { profile, loading } = useProfile(address);
  const [dismissed, setDismissed] = useState(() => wasDismissed(address));
  if (!editor.available || loading || profile.name || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(key(address), '1');
    } catch {
      /* storage blocked: it just shows again next visit */
    }
  };
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-lime/30 bg-lime/[0.06] py-3 pl-5 pr-3">
      <p className="min-w-0 flex-1 text-[15px] text-white">
        <b className="font-display">Claim your username.</b> <span className="text-white/80">Show your crystals with your name.</span>
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-primary" onClick={editor.open}>
          Claim username
        </button>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid h-9 w-9 place-items-center rounded-full text-mist hover:bg-white/5 hover:text-white">
          ✕
        </button>
      </div>
    </div>
  );
}
