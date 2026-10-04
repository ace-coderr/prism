import { useEffect, useState } from 'react';
import { Composition, continueRender, delayRender } from 'remotion';
import { DURATION, Explainer, FPS } from './Explainer';
import { fontsReady } from './theme';

/** Holds every frame until the bundled fonts have loaded. */
function WithFonts() {
  const [handle] = useState(() => delayRender('fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fontsReady.then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);
  return ready ? <Explainer /> : null;
}

export function Root() {
  return (
    <>
      {/* 16:9 for the site (and the poster) */}
      <Composition id="Explainer" component={WithFonts} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
      {/* 1:1 for X */}
      <Composition id="ExplainerSquare" component={WithFonts} durationInFrames={DURATION} fps={FPS} width={1080} height={1080} />
    </>
  );
}
