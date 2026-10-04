import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Footer, Nav } from './components/Nav';
import { Intro } from './components/Intro';
import { EASE } from './components/design';
import Home from './pages/Home';
import Forge from './pages/Forge';
import MyCrystals from './pages/MyCrystals';
import Gallery from './pages/Gallery';
import Agent from './pages/Agent';

// One-time deploy tool: dev server only. In production builds `import.meta.env.DEV` is
// `false`, so this branch (and the page + contract bytecode it imports) is dropped.
const Deploy = import.meta.env.DEV ? lazy(() => import('./pages/Deploy')) : null;

export default function App() {
  const location = useLocation();
  return (
    // "user": honour prefers-reduced-motion everywhere (transforms off, fades kept short)
    <MotionConfig reducedMotion="user">
      <Nav />
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo(0, 0)}>
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
    </MotionConfig>
  );
}
