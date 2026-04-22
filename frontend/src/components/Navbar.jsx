/**
 * Top navigation with user identity and local logout flow.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { Bell, Menu, Sparkles } from 'lucide-react';
import { deleteDocument, listDocuments } from '../services/api';
import { clearStoredSession } from '../utils/localStorage';
import './Navbar.css';

export default function Navbar({
  user,
  showSidebarToggle = false,
  isSidebarOpen = true,
  onSidebarToggle,
  onLogout,
}) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const avatarLabel = user?.name?.[0]?.toUpperCase() || 'D';

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!dropdownRef.current?.contains(event.target)) {
        setIsProfileOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    setIsLoggingOut(true);
    setIsProfileOpen(false);

    try {
      const response = await listDocuments();
      const documents = response?.documents || [];
      await Promise.allSettled(documents.map((document) => deleteDocument(document.id)));
    } catch {
      // Continue with local cleanup even if server deletion fails.
    }

    clearStoredSession(user?.id);
    onLogout?.();
    navigate('/auth', { replace: true });
  };

  return (
    <>
    <header className="navbar">
      <div className="navbar-left">
        {showSidebarToggle && (
          <button
            className={`sidebar-toggle-btn ${isSidebarOpen ? 'open' : ''}`}
            type="button"
            onClick={onSidebarToggle}
            aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
            id="workspace-sidebar-toggle"
          >
            <Menu size={18} />
          </button>
        )}

        <span className="navbar-logo">DocuMind AI</span>

        <nav className="navbar-links">
          <NavLink to="/" className={({ isActive }) => `nav-pill ${isActive ? 'active' : ''}`}>
            Workspace
          </NavLink>
          <NavLink to="/documents" className={({ isActive }) => `nav-pill ${isActive ? 'active' : ''}`}>
            Documents
          </NavLink>
          <NavLink to="/analytics" className={({ isActive }) => `nav-pill ${isActive ? 'active' : ''}`}>
            Analytics
          </NavLink>
        </nav>
      </div>

      <div className="navbar-right">
        <button type="button" className="model-selector-btn" aria-label="Model selector">
          <Sparkles size={12} className="model-dot" />
          <span>Model Selector</span>
        </button>

        <button className="btn-icon" type="button" aria-label="Notifications" id="nav-notifications">
          <Bell size={18} />
        </button>

        <div className="profile-menu" ref={dropdownRef}>
          <button
            className="profile-trigger"
            type="button"
            onClick={() => setIsProfileOpen((current) => !current)}
            aria-expanded={isProfileOpen}
            aria-label="Open profile menu"
          >
            <div className="avatar-ring">
              <div className="avatar-placeholder">
                <span>{avatarLabel}</span>
              </div>
            </div>
            <span className="profile-name">{user?.name}</span>
          </button>

          {isProfileOpen ? (
            <div className="profile-dropdown">
              <div className="profile-dropdown-header">
                <span className="profile-dropdown-name">{user?.name}</span>
                <span className="mono-label">Local profile</span>
              </div>
              <button className="profile-dropdown-action" type="button" onClick={() => { setIsProfileOpen(false); setShowLogoutConfirm(true); }}>
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>

    </header>

    {showLogoutConfirm && createPortal(
      <div className="logout-overlay" role="dialog" aria-modal="true" onClick={() => setShowLogoutConfirm(false)}>
        <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="logout-dialog-icon">⚠️</div>
          <h3 className="logout-dialog-title">Sign out?</h3>
          <p className="logout-dialog-copy">All your local chats and data will be permanently deleted. This cannot be undone.</p>
          <div className="logout-dialog-actions">
            <button className="logout-btn logout-btn-cancel" type="button" onClick={() => setShowLogoutConfirm(false)}>
              No, stay
            </button>
            <button className="logout-btn logout-btn-confirm" type="button" onClick={handleLogout}>
              Yes, sign out
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}

    {isLoggingOut && createPortal(
      <div className="logout-overlay" role="status" aria-label="Signing out">
        <div className="logout-progress-box">
          <span className="logout-progress-spinner" aria-hidden="true" />
          <p className="logout-progress-label">Signing out…</p>
        </div>
      </div>,
      document.body,
    )}
  </>
  );
}
