import { PageHeader, PageScroll } from '../components/PageHeader';
import { useProfileEditor } from '../components/editorContext';
import { Reveal } from '../components/design';
import { GuideNote } from '../components/Viber';
import { XLogo } from '../components/ShareOnX';
import { useProfile } from '../data/profiles';
import { WalletButton, useWallet } from '../wallet/WalletButton';

const POINTS = [
  { n: '01', title: 'Only holders review', text: 'You can review a vibe/vibe launch or a test stock only while you hold it. Each review records how much you held.' },
  { n: '02', title: 'Selling shows', text: 'If a reviewer sells after reviewing, their review is marked SOLD for everyone to see. Reviews can’t be deleted.' },
  { n: '03', title: 'True colors', text: 'Each token gets a score from the reviewers who are still holding, so the people who walked away don’t count.' },
];

/** Placeholder while the new PRISM is built: what's coming, and the one thing to do now. */
export default function Home() {
  return (
    <PageScroll>
      <PageHeader
        label="Coming soon"
        lead="See every launch’s"
        accent="true colors"
        subtitle="PRISM is becoming a review site for vibe/vibe launches where only holders can review, and everyone can see who sold."
        guide={<ProfileNote />}
      />
      <Reveal>
        <ol className="grid gap-4 md:grid-cols-3">
          {POINTS.map((p) => (
            <li key={p.n} className="card flex flex-col gap-3 p-6">
              <span className="font-mono text-sm text-lime">{p.n}</span>
              <p className="font-display text-xl font-bold tracking-[-0.02em]">{p.title}</p>
              <p className="text-[15px] leading-relaxed text-mist">{p.text}</p>
            </li>
          ))}
        </ol>
      </Reveal>
      <p className="text-sm text-mist">
        <a className="inline-flex items-center gap-1.5 text-white hover:text-lime" href="https://x.com/holdprism" target="_blank" rel="noreferrer">
          <XLogo /> Follow @holdprism
        </a>{' '}
        for the launch.
      </p>
    </PageScroll>
  );
}

/** The one thing to do today: pick the @username your reviews will carry. */
function ProfileNote() {
  const { address } = useWallet();
  const { profile } = useProfile(address);
  const editor = useProfileEditor();
  if (address && profile.name) {
    return (
      <GuideNote index={0}>
        You’re set, <b>@{profile.name}</b>. Your reviews will carry your name when PRISM opens.
      </GuideNote>
    );
  }
  return (
    <GuideNote
      index={0}
      action={
        address ? (
          editor.available && (
            <button type="button" className="btn btn-primary" onClick={editor.open}>
              Pick a username
            </button>
          )
        ) : (
          <WalletButton variant="hero" />
        )
      }
    >
      While we build it, pick your <b>@username</b>, so your reviews carry your name from day one. Log in with email, Google, X or a wallet.
    </GuideNote>
  );
}
