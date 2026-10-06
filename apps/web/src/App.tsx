import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Footer, Nav } from './components/Nav';
import { Intro } from './components/Intro';
import { ProfileEditorProvider } from './components/ProfileEditor';
import { EASE } from './components/design';
import { useSnapshot } from './data/snapshot';
import Home from './pages/Home';
import Forge from './pages/Forge';
import MyCrystals from './pages/MyCrystals';
import Gallery from './pages/Gallery';
import Agent from './pages/Agent';
import Profile from './pages/Profile';
import GiftPage from './pages/GiftPage';
import ReplayPage from './pages/ReplayPage';

// One-time deploy tool: dev server only. In production builds `import.meta.env.DEV` is
// `false`, so this branch (and the page + contract bytecode it imports) is dropped.
const Deploy = import.meta.env.DEV ? lazy(() => import('./pages/Deploy')) : null;

export default function App() {
  const location = useLocation();
  // the cached chain snapshot: every page renders from it until live data lands
  useSnapshot();
  return (
    // "user": honour prefers-reduced-motion everywhere (transforms off, fades kept short)
    <MotionConfig reducedMotion="user">
      <ProfileEditorProvider>
        <Nav />
        {/* jump (not glide: html is scroll-behavior smooth) to the top before the next page appears;
            a smooth scroll could be cut short as that page grows, leaving its title under the navbar */}
        <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })}>
          <motion.main
            key={location.pathname}
            className="relative flex-1"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <Routes location={location}>
              <Route path="/" element={<Home />} />
              <Route path="/forge" element={<Forge />} />
              <Route path="/my-crystals" element={<MyCrystals />} />
              <Route path="/crystals" element={<Navigate to="/my-crystals" replace />} />
              <Route path="/gallery" element={<Gallery />} />
              <Route path="/agent" element={<Agent />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/u/:id" element={<Profile />} />
              <Route path="/gift/:id" element={<GiftPage />} />
              <Route path="/replay/:id" element={<ReplayPage />} />
              {Deploy && (
                <Route
                  path="/deploy"
                  element={
                    <Suspense fallback={null}>
                      <Deploy />
                    </Suspense>
                  }
                />
              )}
              <Route path="*" element={<Home />} />
            </Routes>
          </motion.main>
        </AnimatePresence>
        <Footer />
        <Intro />
      </ProfileEditorProvider>
    </MotionConfig>
  );
}
