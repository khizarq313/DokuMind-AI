import { NavLink } from 'react-router-dom';
import { MessageSquare, FileText, BarChart2 } from 'lucide-react';
import './MobileTabBar.css';

export default function MobileTabBar() {
  return (
    <nav className="mobile-tab-bar">
      <NavLink to="/" end className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>
        <MessageSquare size={20} />
        <span>Chat</span>
      </NavLink>
      <NavLink to="/documents" className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>
        <FileText size={20} />
        <span>Documents</span>
      </NavLink>
      <NavLink to="/analytics" className={({ isActive }) => `tab-item ${isActive ? 'active' : ''}`}>
        <BarChart2 size={20} />
        <span>Analytics</span>
      </NavLink>
    </nav>
  );
}
