import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveStoredUser } from '../utils/localStorage';
import './AuthPage.css';

export default function AuthPage({ onAuthChange }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const trimmedName = useMemo(() => name.trim(), [name]);

  useEffect(() => {
    document.title = 'DocuMind \u2013 Sign in';
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!trimmedName) {
      setError('Please enter your name to continue.');
      return;
    }

    const user = {
      name: trimmedName,
      id: Date.now(),
    };

    saveStoredUser(user);
    onAuthChange?.(user);
    navigate('/', { replace: true });
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <span className="mono-label auth-kicker">Local-first workspace</span>
        <h1 className="auth-title">Welcome to DocuMind</h1>
        <p className="auth-copy">
          Enter your name to get started. Your chats and documents are stored locally on your device, so nothing leaves your device.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="documind-name">
            Enter your name
          </label>
          <input
            id="documind-name"
            className="input-field auth-input"
            type="text"
            placeholder="Full Name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) {
                setError('');
              }
            }}
            autoFocus
          />

          {error && <p className="auth-error">{error}</p>}

          <button className="btn-primary auth-submit" type="submit">
            Start using DocuMind {'\u2192'}
          </button>
        </form>
      </div>
    </div>
  );
}
