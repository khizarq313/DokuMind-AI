import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Clock,
  EllipsisVertical,
  File,
  FileText,
  Search,
  Star,
  Upload,
} from 'lucide-react';
import { deleteDocument, listDocuments } from '../services/api';
import {
  getStoredDocuments,
  getStoredFavorites,
  mergeKnownDocuments,
  removeStoredDocumentReferences,
  saveStoredDocuments,
  saveStoredFavorites,
} from '../utils/localStorage';
import './DocumentsPage.css';

const TABS = ['All Files', 'Recent', 'Favorites'];

function normalizeDocument(document, fallback = {}) {
  return {
    ...fallback,
    ...document,
    mime_type: document.mime_type || fallback.mime_type || 'application/pdf',
    updated_at: document.updated_at || document.created_at || fallback.updated_at || new Date().toISOString(),
    status: document.status || fallback.status || 'processing',
    isServerBacked: document.isServerBacked ?? fallback.isServerBacked ?? false,
  };
}

function sortDocuments(documents) {
  return [...documents].sort((left, right) => (
    new Date(right.updated_at || right.created_at || 0).getTime()
    - new Date(left.updated_at || left.created_at || 0).getTime()
  ));
}

function formatRelativeTime(value) {
  if (!value) {
    return 'just now';
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return 'just now';
  }

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) {
    return 'just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.round(diffHours / 24)}d ago`;
}

function formatFileSize(sizeBytes) {
  if (!sizeBytes) {
    return '0 MB';
  }

  return `${Math.max(1, Math.round(sizeBytes / 1_000_000))} MB`;
}

function getDocumentStats(document) {
  if (document.page_count != null && document.chunk_count != null) {
    return `${document.page_count} pages \u00b7 ${document.chunk_count} chunks`;
  }

  return formatFileSize(document.size_bytes);
}

export default function DocumentsPage({ user }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('All Files');
  const [docs, setDocs] = useState(() => sortDocuments(getStoredDocuments(user?.id).map((document) => normalizeDocument(document))));
  const [favorites, setFavorites] = useState(() => getStoredFavorites(user?.id));
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(docs.length === 0);
  const [error, setError] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const hasDocuments = docs.length > 0;

  useEffect(() => {
    document.title = 'DocuMind \u2013 Documents';
  }, []);

  useEffect(() => {
    setDocs(sortDocuments(getStoredDocuments(user?.id).map((document) => normalizeDocument(document))));
    setFavorites(getStoredFavorites(user?.id));
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      saveStoredDocuments(user.id, docs);
    }
  }, [docs, user?.id]);

  useEffect(() => {
    if (user?.id) {
      saveStoredFavorites(user.id, favorites);
    }
  }, [favorites, user?.id]);

  useEffect(() => {
    let isDisposed = false;

    const loadDocuments = async () => {
      try {
        const response = await listDocuments();
        if (isDisposed) {
          return;
        }

        const apiDocuments = (response.documents || []).map((document) => (
          normalizeDocument(document, { isServerBacked: true })
        ));
        setDocs((current) => sortDocuments(
          mergeKnownDocuments(apiDocuments, current).map((document) => normalizeDocument(document)),
        ));
        setError('');
      } catch {
        if (!isDisposed) {
          setError('Documents are unavailable right now. Local history is still available.');
        }
      } finally {
        if (!isDisposed) {
          setLoading(false);
        }
      }
    };

    void loadDocuments();
    const intervalId = window.setInterval(() => {
      void loadDocuments();
    }, 5000);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.doc-menu')) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const filteredDocs = useMemo(() => {
    let nextDocs = docs.filter((document) => (
      document.filename.toLowerCase().includes(searchQuery.toLowerCase())
    ));

    if (activeTab === 'Favorites') {
      nextDocs = nextDocs.filter((document) => favorites.includes(document.id));
    }

    if (activeTab === 'Recent') {
      nextDocs = nextDocs.slice(0, 8);
    }

    return nextDocs;
  }, [activeTab, docs, favorites, searchQuery]);

  const isFilteredEmpty = hasDocuments && filteredDocs.length === 0;

  const getFileIcon = (mimeType) => {
    if (mimeType === 'application/pdf') {
      return <FileText size={20} />;
    }

    return <File size={20} />;
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'indexed':
        return <span className="chip chip-success"><Check size={10} /> Indexed</span>;
      case 'processing':
      case 'indexing':
      case 'uploading':
        return <span className="chip chip-warning"><Clock size={10} /> Indexing...</span>;
      case 'failed':
        return <span className="chip chip-error"><AlertTriangle size={10} /> Failed</span>;
      default:
        return null;
    }
  };

  const handleOpenWorkspace = (documentId) => {
    setOpenMenuId(null);
    navigate(`/?docId=${documentId}`);
  };

  const handleToggleFavorite = (documentId) => {
    setFavorites((current) => (
      current.includes(documentId)
        ? current.filter((favoriteId) => favoriteId !== documentId)
        : [...current, documentId]
    ));
  };

  const handleDeleteDocument = async (document) => {
    if (document.isServerBacked) {
      try {
        await deleteDocument(document.id);
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : 'Failed to delete document.';
        setError(message);
        return;
      }
    }

    removeStoredDocumentReferences(user?.id, document.id);
    setDocs((current) => current.filter((item) => item.id !== document.id));
    setFavorites((current) => current.filter((favoriteId) => favoriteId !== document.id));
    setOpenMenuId(null);
  };

  return (
    <div className="documents-page animate-fade-in">
      <div className="documents-content">
        <div className="documents-header animate-fade-in">
          <div className="documents-header-text">
            <span className="mono-label documents-kicker">Intelligence Engine</span>
            <h1 className="text-headline-lg documents-title">
              Your Documents
            </h1>
            <p className="documents-subtitle">
              {hasDocuments ? `${docs.length} documents in your local workspace` : 'Your indexed PDFs will appear here automatically.'}
            </p>
          </div>
        </div>

        <div className="documents-controls">
          <div className="documents-tabs">
            {TABS.map((tab) => (
              <button
                key={tab}
                className={`doc-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
                id={`tab-${tab.toLowerCase().replace(' ', '-')}`}
                type="button"
              >
                {activeTab === tab ? <Check size={14} /> : null}
                {tab}
              </button>
            ))}
          </div>
          <div className="documents-search">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="search-input"
              id="doc-search"
            />
          </div>
        </div>

        {error && hasDocuments ? (
          <div className="documents-status-banner">
            {error}
          </div>
        ) : null}

        {loading && !hasDocuments ? (
          <div className="documents-empty-state">
            <p className="documents-empty-title">Loading documents...</p>
          </div>
        ) : !hasDocuments ? (
          <div className="documents-empty-state">
            <p className="documents-empty-title">No documents yet</p>
            <p className="documents-empty-copy">
              {error || 'Upload a PDF from the workspace and it will appear here once indexing starts.'}
            </p>
            <Link className="btn-primary documents-empty-action" to="/">
              Open Workspace
            </Link>
          </div>
        ) : isFilteredEmpty ? (
          <div className="documents-empty-state">
            <p className="documents-empty-title">No documents in this view</p>
            <p className="documents-empty-copy">
              Try another tab or adjust your search to see matching documents.
            </p>
          </div>
        ) : (
          <div className="documents-grid">
            {filteredDocs.map((doc, index) => {
              const isFavorite = favorites.includes(doc.id);

              return (
                <div
                  key={doc.id}
                  className="document-card animate-fade-in"
                  style={{ animationDelay: `${index * 0.05}s` }}
                  id={`document-card-${doc.id}`}
                >
                  <div className="doc-card-body">
                    <div className="doc-card-icon-row">
                      <div className="doc-card-leading">
                        <div className="doc-card-file-icon pdf">
                          {getFileIcon(doc.mime_type)}
                        </div>
                        {!doc.isServerBacked ? (
                          <span className="chip chip-primary">Local only</span>
                        ) : null}
                      </div>

                      <div className="doc-card-actions">
                        <button
                          className={`btn-icon star-toggle ${isFavorite ? 'active' : ''}`}
                          type="button"
                          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                          onClick={() => handleToggleFavorite(doc.id)}
                        >
                          <Star size={16} />
                        </button>

                        <div className="doc-menu">
                          <button
                            className="btn-icon"
                            type="button"
                            aria-label="More options"
                            aria-expanded={openMenuId === doc.id}
                            onClick={() => setOpenMenuId((current) => (current === doc.id ? null : doc.id))}
                          >
                            <EllipsisVertical size={16} />
                          </button>

                          {openMenuId === doc.id ? (
                            <div className="doc-menu-dropdown">
                              <button type="button" onClick={() => handleOpenWorkspace(doc.id)}>
                                Open in Workspace
                              </button>
                              <button type="button" onClick={() => handleDeleteDocument(doc)}>
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <h3 className="doc-card-title">{doc.filename}</h3>
                    <p className="doc-card-meta mono">
                      Modified {formatRelativeTime(doc.updated_at)} {'\u00b7'} {formatFileSize(doc.size_bytes)}
                    </p>

                    <div className="doc-card-footer">
                      <div className="doc-card-footer-meta">
                        {getStatusBadge(doc.status)}
                        <span className="doc-card-stats">{getDocumentStats(doc)}</span>
                      </div>
                      <button
                        className="doc-open-action"
                        type="button"
                        onClick={() => handleOpenWorkspace(doc.id)}
                      >
                        Open in Workspace
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasDocuments ? (
          <Link className="upload-fab" to="/" id="upload-fab" aria-label="Upload from workspace">
            <Upload size={24} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
