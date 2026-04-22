import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

const DEV_SW_RESET_KEY = 'documind_dev_sw_reset';
const DOCUMIND_CACHE_PREFIX = 'documind-shell';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const hadRegistrations = registrations.length > 0;

        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ('caches' in window) {
          const cacheKeys = await window.caches.keys();
          await Promise.all(
            cacheKeys
              .filter((key) => key.startsWith(DOCUMIND_CACHE_PREFIX))
              .map((key) => window.caches.delete(key)),
          );
        }

        if (hadRegistrations && !window.sessionStorage.getItem(DEV_SW_RESET_KEY)) {
          window.sessionStorage.setItem(DEV_SW_RESET_KEY, '1');
          window.location.reload();
          return;
        }

        if (!hadRegistrations) {
          window.sessionStorage.removeItem(DEV_SW_RESET_KEY);
        }
      } catch {
        window.sessionStorage.removeItem(DEV_SW_RESET_KEY);
      }
    })();
  });
}
