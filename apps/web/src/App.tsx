import { Suspense, lazy } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Footer, Nav } from './components/Nav';
import { ProfileEditorProvider } from './components/ProfileEditor';
import { EASE } from './components/design';
import Home from './pages/Home';
import Profile from './pages/Profile';

// One-time deploy tool: dev server only. In production builds `import.meta.env.DEV` is
// `false`, so this branch (and the page + contract bytecode it imports) is dropped.
const Deploy = import.meta.env.DEV ? lazy(() => import('./pages/Deploy')) : null;

export default function App() {
  const location = useLocation();
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
              <Route path="/profile" element={<Profile />} />
              <Route path="/u/:id" element={<Profile />} />
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
              {/* old crystal-app links (/forge, /gallery, /gift/…, /claim/…) land on the placeholder */}
              <Route path="*" element={<Home />} />
            </Routes>
          </motion.main>
        </AnimatePresence>
        <Footer />
      </ProfileEditorProvider>
    </MotionConfig>
  );
}
