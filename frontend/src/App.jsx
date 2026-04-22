/**
 * DocuMind app shell with local user gating and route-level persistence.
 */

import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import MobileTabBar from './components/MobileTabBar';
import Navbar from './components/Navbar';
import AnalyticsPage from './pages/AnalyticsPage';
import AuthPage from './pages/AuthPage';
import DocumentsPage from './pages/DocumentsPage';
import WorkspacePage from './pages/WorkspacePage';
import { getStoredUser } from './utils/localStorage';

function AppShell() {
  const location = useLocation();
  const [user, setUser] = useState(() => getStoredUser());
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => (
    typeof window === 'undefined' ? true : window.innerWidth > 768
  ));

  const isWorkspaceRoute = location.pathname === '/';
  const isAuthRoute = location.pathname === '/auth';

  useEffect(() => {
    const handleStorage = () => {
      setUser(getStoredUser());
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  if (!user && !isAuthRoute) {
    return <Navigate to="/auth" replace />;
  }

  if (user && isAuthRoute) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      {!isAuthRoute && user ? (
        <Navbar
          user={user}
          showSidebarToggle={isWorkspaceRoute}
          isSidebarOpen={isSidebarOpen}
          onSidebarToggle={() => setIsSidebarOpen((current) => !current)}
          onLogout={() => setUser(null)}
        />
      ) : null}

      <Routes>
        <Route path="/auth" element={<AuthPage onAuthChange={setUser} />} />
        <Route
          path="/"
          element={(
            <WorkspacePage
              user={user}
              isSidebarOpen={isSidebarOpen}
              onSidebarOpenChange={setIsSidebarOpen}
            />
          )}
        />
        <Route path="/documents" element={<DocumentsPage user={user} />} />
        <Route path="/analytics" element={<AnalyticsPage user={user} />} />
      </Routes>

      {!isAuthRoute && user ? <MobileTabBar /> : null}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
