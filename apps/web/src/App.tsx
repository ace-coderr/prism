import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Footer, Nav } from './components/Nav';
import { Intro } from './components/Intro';
import Home from './pages/Home';
import Forge from './pages/Forge';
import MyCrystals from './pages/MyCrystals';
import Gallery from './pages/Gallery';
import Agent from './pages/Agent';

// One-time deploy tool: dev server only. In production builds `import.meta.env.DEV` is
// `false`, so this branch (and the page + contract bytecode it imports) is dropped.
const Deploy = import.meta.env.DEV ? lazy(() => import('./pages/Deploy')) : null;

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <Nav />
      {/* the nav floats above the page: content starts below the pill (16px gap + pill + 16px) */}
      <main className="relative min-h-0 flex-1 pt-20 sm:pt-[88px]">
        <div className="relative h-full">
          <Routes>
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
        </div>
      </main>
      <Footer />
      <Intro />
    </div>
  );
}
