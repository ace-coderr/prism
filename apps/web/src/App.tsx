import { Route, Routes } from 'react-router-dom';
import { Footer, Nav } from './components/Nav';
import Home from './pages/Home';
import Forge from './pages/Forge';
import MyCrystals from './pages/MyCrystals';
import Gallery from './pages/Gallery';
import Agent from './pages/Agent';

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <Nav />
      <main className="relative min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/forge" element={<Forge />} />
          <Route path="/crystals" element={<MyCrystals />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
