import { Suspense, lazy } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Footer, Nav } from './components/Nav';
import { PageHeader, PageScroll } from './components/PageHeader';
import { ProfileEditorProvider } from './components/ProfileEditor';
import { GuideNote } from './components/Viber';
import { EASE } from './components/design';
import Archived from './pages/Archived';
import Home from './pages/Home';
import LaunchPage from './pages/Launch';
import Leaderboards from './pages/Leaderboards';
import Legacy from './pages/Legacy';
import Profile from './pages/Profile';
import ReviewPage from './pages/ReviewPage';
import Search from './pages/Search';
import Stocks from './pages/Stocks';
import WriteReview from './pages/WriteReview';

// One-time deploy tool: dev server only. In production builds `import.meta.env.DEV` is
// `false`, so this branch (and the page + contract bytecode it imports) is dropped.
const Deploy = import.meta.env.DEV ? lazy(() => import('./pages/Deploy')) : null;

/** PRISM v1 routes: they show the archived note (and the way to /legacy), never a 404. */
const V1_ROUTES = ['/forge', '/my-crystals', '/crystals', '/gallery', '/agent', '/gift/*', '/replay/*', '/claim/*'];

function NotFound() {
  return (
    <PageScroll>
      <PageHeader
        label="Not found"
        lead="Nothing"
        accent="here."
        subtitle="This page doesn’t exist. Search a launch from Home instead."
        guide={
          <GuideNote index={2} action={<Link to="/" className="btn btn-primary">Go to Home</Link>}>
            Looking for a token? Paste its address into the search on Home.
          </GuideNote>
        }
      />
    </PageScroll>
  );
}

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
              <Route path="/t/:address" element={<LaunchPage />} />
              <Route path="/t/:address/review" element={<WriteReview />} />
              <Route path="/r/:id" element={<ReviewPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/u/:id" element={<Profile />} />
              <Route path="/leaderboards" element={<Leaderboards />} />
              <Route path="/stocks" element={<Stocks />} />
              <Route path="/search" element={<Search />} />
              <Route path="/legacy" element={<Legacy />} />
              {V1_ROUTES.map((p) => (
                <Route key={p} path={p} element={<Archived />} />
              ))}
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
              <Route path="*" element={<NotFound />} />
            </Routes>
          </motion.main>
        </AnimatePresence>
        <Footer />
      </ProfileEditorProvider>
    </MotionConfig>
  );
}
