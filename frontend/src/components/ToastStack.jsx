/**
 * ToastStack — Lightweight toast notifications for upload and indexing events.
 */

import './ToastStack.css';

export default function ToastStack({ toasts = [] }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-card ${toast.tone || 'info'}`}>
          <p className="toast-message">{toast.message}</p>
        </div>
      ))}
    </div>
  );
}
