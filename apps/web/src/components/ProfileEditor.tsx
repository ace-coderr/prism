import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { simulateContract } from 'wagmi/actions';
import { BIO_MAX_BYTES, NAME_MAX, X_MAX, atName, bioBytes, bioProblem, identicon, normalizeX, prismProfilesAbi, xProblem } from '@prism/core';
import { CrystalThumb } from './CrystalThumb';
import { EditorContext } from './editorContext';
import { useMyCrystals } from '../data/crystals';
import { profilesContract, useCrystalShapes, useNameAvailability, useProfile, type Profile } from '../data/profiles';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { StepList, useTxSteps } from '../wallet/steps';
import { SwitchNetworkButton, WalletButton, useWallet } from '../wallet/WalletButton';

export function ProfileEditorProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const value = useMemo(() => ({ open: () => setOpen(true), available: !!profilesContract() }), []);
  return (
    <EditorContext.Provider value={value}>
      {children}
      {isOpen && <EditProfileModal onClose={() => setOpen(false)} />}
    </EditorContext.Provider>
  );
}

const STATUS: Record<string, { text: string; tone: string }> = {
  checking: { text: 'Checking…', tone: 'text-mist' },
  available: { text: 'Available ✓', tone: 'text-up' },
  taken: { text: 'Taken by someone else', tone: 'text-down' },
  yours: { text: 'That’s already yours', tone: 'text-mist' },
};

const FIELD = 'w-full min-w-0 rounded-xl border border-white/10 bg-ink px-3 py-2.5 text-sm outline-none focus:border-lime/60';

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { address, isConnected, onTarget } = useWallet();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // flex + m-auto so a modal taller than a phone screen still scrolls to its top
    <div className="fixed inset-0 z-[60] flex overflow-y-auto bg-ink/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
      <div className="m-auto w-full max-w-[560px] rounded-3xl border border-white/10 bg-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="section-label">Your profile</p>
            <h2 id="edit-profile-title" className="headline mt-2 text-3xl">
              Edit profile
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-mist hover:bg-white/5 hover:text-white">
            ✕
          </button>
        </div>
        {!profilesContract() ? (
          <p className="mt-6 text-sm text-mist">Profiles turn on once their contract is deployed.</p>
        ) : !isConnected || !address ? (
          <div className="mt-6 flex flex-col items-start gap-4">
            <p className="text-sm text-mist">Connect your wallet to edit your profile.</p>
            <WalletButton variant="hero" />
          </div>
        ) : (
          <EditForm address={address} onTarget={onTarget} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function EditForm({ address, onTarget, onClose }: { address: Address; onTarget: boolean; onClose: () => void }) {
  const contract = profilesContract()!;
  const { profile, loading, refetch } = useProfile(address);
  // lives here so it survives the fields remounting with the freshly saved profile
  const [saved, setSaved] = useState(false);
  if (loading) return <p className="mt-6 text-sm text-mist">Reading your profile…</p>;
  // remount when the saved profile changes so the fields start from it
  return (
    <Fields
      key={JSON.stringify(profile, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}
      {...{ address, onTarget, onClose, contract, profile, refetch, saved, setSaved }}
    />
  );
}

function Fields({
  address,
  onTarget,
  onClose,
  contract,
  profile,
  refetch,
  saved,
  setSaved,
}: {
  address: Address;
  onTarget: boolean;
  onClose: () => void;
  contract: Address;
  profile: Profile;
  refetch: () => unknown;
  saved: boolean;
  setSaved: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile.name ?? '');
  const [avatar, setAvatar] = useState<bigint | null>(profile.avatarId);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [x, setX] = useState(profile.x ?? '');
  const tx = useTxSteps();
  const crystals = useMyCrystals(address);
  const shapes = useCrystalShapes();
  const gem = useMemo(() => identicon(address), [address]);

  const nameChanged = name !== (profile.name ?? '');
  const check = useNameAvailability(nameChanged ? name : '', address);
  const bioErr = bioProblem(bio);
  const xErr = xProblem(x);
  const changes = {
    name: nameChanged,
    avatar: avatar !== profile.avatarId,
    bio: bio !== (profile.bio ?? ''),
    x: x !== (profile.x ?? ''),
  };
  const dirty = Object.values(changes).some(Boolean);
  const nameOk = !changes.name || name === '' || check.status === 'available';
  const canSave = dirty && nameOk && !bioErr && !xErr && !tx.running;

  const save = async () => {
    // one transaction: setProfile for new values; removed fields are cleared in the same multicall
    const set = {
      name: changes.name && name ? name : '',
      avatar: changes.avatar && avatar ? avatar : 0n,
      bio: changes.bio && bio ? bio : '',
      x: changes.x && x ? x : '',
    };
    const clears = [
      changes.name && !name && ('clearName' as const),
      changes.avatar && !avatar && ('clearAvatar' as const),
      changes.bio && !bio && ('clearBio' as const),
      changes.x && !x && ('clearX' as const),
    ].filter((c): c is 'clearName' | 'clearAvatar' | 'clearBio' | 'clearX' => !!c);
    const hasSet = !!(set.name || set.avatar || set.bio || set.x);
    const base = { address: contract, abi: prismProfilesAbi, chainId: TARGET_CHAIN.id, account: address } as const;
    setSaved(false);
    const ok = await tx.run([
      {
        label: 'Saving your profile',
        tx: { description: 'Save your PRISM profile on-chain: username, avatar crystal, bio and X handle.', action: 'Save profile', contract: 'PrismProfiles' },
        send: async (write) => {
          if (hasSet && clears.length === 0) {
            const { request } = await simulateContract(wagmiConfig, { ...base, functionName: 'setProfile', args: [set.name, set.avatar, set.bio, set.x] });
            return write(request);
          }
          if (!hasSet && clears.length === 1) {
            const { request } = await simulateContract(wagmiConfig, { ...base, functionName: clears[0]! });
            return write(request);
          }
          const calls: Hex[] = [
            ...(hasSet ? [encodeFunctionData({ abi: prismProfilesAbi, functionName: 'setProfile', args: [set.name, set.avatar, set.bio, set.x] })] : []),
            ...clears.map((fn) => encodeFunctionData({ abi: prismProfilesAbi, functionName: fn })),
          ];
          const { request } = await simulateContract(wagmiConfig, { ...base, functionName: 'multicall', args: [calls] });
          return write(request);
        },
      },
    ]);
    if (ok) {
      setSaved(true);
      // profile reads everywhere (wagmi contract reads + name lookups) pick up the change
      await queryClient.invalidateQueries({
        predicate: (q) => ['readContract', 'readContracts', 'address-of-name'].includes(String(q.queryKey[0])),
      });
      refetch();
    }
  };

  const nameStatus = check.problem
    ? { text: check.problem, tone: check.status === 'invalid' ? 'text-down' : 'text-mist' }
    : nameChanged && !name
      ? { text: profile.name ? `Saving removes ${atName(profile.name)}, so anyone can take it.` : '', tone: 'text-mist' }
      : STATUS[check.status];

  return (
    <div className="mt-6 flex flex-col gap-6">
      <label className="block">
        <span className="section-label text-[11px]">Username</span>
        <span className="mt-2 flex items-center rounded-xl border border-white/10 bg-ink focus-within:border-lime/60">
          <span className="pl-3 font-mono text-sm text-mist">@</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s/g, '_').slice(0, NAME_MAX))}
            placeholder="your_name"
            aria-label="Username"
            maxLength={NAME_MAX}
            className="w-full min-w-0 bg-transparent px-1.5 py-2.5 font-mono text-sm outline-none"
          />
        </span>
        <span className={`mt-1.5 block min-h-[1rem] text-[12px] ${nameStatus?.tone ?? ''}`}>{nameStatus?.text}</span>
      </label>

      <fieldset>
        <legend className="section-label text-[11px]">Avatar</legend>
        <p className="mt-1 text-[12px] text-mist">One of your crystals. It stops being your avatar if you give it away.</p>
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
          <AvatarOption selected={avatar === null} label="Gem (from your address)" onClick={() => setAvatar(null)}>
            <CrystalThumb holdings={gem.holdings} hue={gem.hue} size={48} />
          </AvatarOption>
          {(crystals.data ?? []).map((c) => {
            const s = shapes.get(c.id);
            return (
              <AvatarOption key={c.id.toString()} selected={avatar === c.id} label={`Crystal #${c.id}`} onClick={() => setAvatar(c.id)}>
                {s ? <CrystalThumb holdings={s.holdings} history={s.history} sealed={s.sealed} size={48} /> : <span className="font-mono text-[11px] text-mist">#{c.id.toString()}</span>}
              </AvatarOption>
            );
          })}
        </div>
        {crystals.isLoading && <p className="mt-2 text-[12px] text-mist">Reading your crystals…</p>}
      </fieldset>

      <label className="block">
        <span className="flex items-baseline justify-between">
          <span className="section-label text-[11px]">Bio</span>
          <span className={`font-mono text-[11px] ${bioBytes(bio) > BIO_MAX_BYTES ? 'text-down' : 'text-mist'}`}>
            {bioBytes(bio)} / {BIO_MAX_BYTES}
          </span>
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.replace(/[\r\n]+/g, ' '))}
          rows={2}
          placeholder="One line about you"
          aria-label="Bio"
          className={`${FIELD} mt-2 resize-none`}
        />
        {bioErr && <span className="mt-1.5 block text-[12px] text-down">{bioErr}</span>}
      </label>

      <label className="block">
        <span className="section-label text-[11px]">X handle</span>
        <span className="mt-2 flex items-center rounded-xl border border-white/10 bg-ink focus-within:border-lime/60">
          <span className="pl-3 font-mono text-sm text-mist">@</span>
          <input
            value={x}
            onChange={(e) => setX(normalizeX(e.target.value).slice(0, X_MAX + 5))}
            placeholder="handle"
            aria-label="X handle"
            className="w-full min-w-0 bg-transparent px-1.5 py-2.5 font-mono text-sm outline-none"
          />
        </span>
        <span className={`mt-1.5 block text-[12px] ${xErr ? 'text-down' : 'text-mist'}`}>{xErr ?? 'Unverified: it links to x.com, but anyone can type any handle.'}</span>
      </label>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={tx.running}>
          {saved ? 'Close' : 'Cancel'}
        </button>
        {!onTarget ? (
          <SwitchNetworkButton />
        ) : (
          <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>
            {tx.running ? 'Saving…' : saved && !dirty ? 'Saved ✓' : 'Save'}
          </button>
        )}
      </div>
      {saved && !tx.running && <p className="-mt-3 text-right text-sm text-up">Saved. Your profile is updated everywhere.</p>}
      <StepList steps={tx.steps} />
    </div>
  );
}

function AvatarOption({ selected, label, onClick, children }: { selected: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid aspect-square place-items-center rounded-2xl border bg-ink transition-colors ${
        selected ? 'border-lime ring-1 ring-lime' : 'border-white/10 hover:border-white/30'
      }`}
    >
      {children}
    </button>
  );
}
