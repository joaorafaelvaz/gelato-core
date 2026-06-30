import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PosProvider } from './contexts/PosContext';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';

export default function App() {
  return (
    <BrowserRouter>
      <PosProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PosPage />} />
        </Routes>
      </PosProvider>
    </BrowserRouter>
  );
}
