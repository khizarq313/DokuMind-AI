/**
 * Sidebar - Chat session navigation with delete, rename, and clear-all actions.
 */

import { MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './Sidebar.css';

function getChatMeta(chat) {
  if (chat.status === 'indexed') {
    return 'Document ready';
  }

  if (chat.status === 'processing' || chat.status === 'indexing' || chat.status === 'uploading') {
    return 'Indexing document...';
  }

  if (chat.status === 'failed') {
    return 'Upload failed';
  }

  if (chat.documentId) {
    return 'Document attached';
  }

  return 'Start by uploading a document';
}

function StatusBadge({ status }) {
  if (status === 'indexed') {
    return <span className="chip chip-secondary">Ready</span>;
  }

  if (status === 'processing' || status === 'indexing' || status === 'uploading') {
    return <span className="chip chip-warning">Indexing</span>;
  }

  if (status === 'failed') {
    return <span className="chip chip-error">Failed</span>;
  }

  return null;
}

export default function Sidebar({
  chats = [],
  activeChatId,
  isOpen = true,
  onChatSelect,
  onClose,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onClearAllChats,
}) {
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState(null);
  const [clearAllPending, setClearAllPending] = useState(false);
  const [editingChatId, setEditingChatId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const editInputRef = useRef(null);

  useEffect(() => {
    if (editingChatId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingChatId]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      if (
        event.target.closest('.chat-delete-btn')
        || event.target.closest('.clear-all-btn')
      ) {
        return;
      }

      setPendingDeleteChatId(null);
      setClearAllPending(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const handleChatSelect = (chatId) => {
    setPendingDeleteChatId(null);
    setClearAllPending(false);
    onChatSelect?.(chatId);

    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      onClose?.();
    }
  };

  const startRename = (chat) => {
    setPendingDeleteChatId(null);
    setClearAllPending(false);
    setEditingChatId(chat.id);
    setDraftTitle(chat.title);
  };

  const finishRename = (chat) => {
    const trimmedTitle = draftTitle.trim();
    if (trimmedTitle && trimmedTitle !== chat.title) {
      onRenameChat?.(chat.id, trimmedTitle);
    }

    setEditingChatId(null);
    setDraftTitle('');
  };

  const cancelRename = () => {
    setEditingChatId(null);
    setDraftTitle('');
  };

  const handleDeleteClick = (event, chat) => {
    event.stopPropagation();
    setClearAllPending(false);
    setEditingChatId(null);

    if (pendingDeleteChatId === chat.id) {
      onDeleteChat?.(chat.id);
      setPendingDeleteChatId(null);
      return;
    }

    setPendingDeleteChatId(chat.id);
  };

  const handleClearAllClick = () => {
    setPendingDeleteChatId(null);

    if (clearAllPending) {
      onClearAllChats?.();
      setClearAllPending(false);
      return;
    }

    setClearAllPending(true);
  };

  return (
    <>
      <button
        type="button"
        className={`sidebar-backdrop ${isOpen ? 'open' : ''}`}
        aria-label="Close sidebar"
        onClick={onClose}
      />

      <aside className={`sidebar ${isOpen ? 'open' : 'collapsed'}`}>
        <div className="sidebar-header">
          <button className="new-chat-btn" type="button" onClick={onNewChat} id="new-chat-button">
            <Plus size={16} />
            <span>New Chat</span>
          </button>

          {chats.length > 0 ? (
            <button
              className={`clear-all-btn ${clearAllPending ? 'pending' : ''}`}
              type="button"
              onClick={handleClearAllClick}
            >
              {clearAllPending ? 'Confirm clear' : 'Clear all'}
            </button>
          ) : null}

          <button
            className="sidebar-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="sidebar-section">
          <span className="mono-label">Chats</span>
        </div>

        <div className="chat-list">
          {chats.length === 0 ? (
            <div className="chat-empty-state">
              <p className="chat-empty-title">No chats yet</p>
              <p className="chat-empty-copy">Upload a document from the workspace to start a new conversation.</p>
            </div>
          ) : (
            chats.map((chat) => {
              const isEditing = editingChatId === chat.id;
              const isConfirmingDelete = pendingDeleteChatId === chat.id;

              return (
                <div
                  key={chat.id}
                  className={`chat-item ${activeChatId === chat.id ? 'active' : ''} ${isConfirmingDelete ? 'danger' : ''}`}
                  id={`chat-${chat.id}`}
                >
                  {isEditing ? (
                    <div className="chat-select-btn editing">
                      <MessageSquare size={18} className="chat-item-icon" />
                      <div className="chat-item-info">
                        <input
                          ref={editInputRef}
                          className="chat-title-input"
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          onBlur={() => finishRename(chat)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              finishRename(chat);
                            }

                            if (event.key === 'Escape') {
                              cancelRename();
                            }
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="chat-select-btn"
                      onClick={() => handleChatSelect(chat.id)}
                    >
                      <MessageSquare size={18} className="chat-item-icon" />
                      <div className="chat-item-info">
                        <p
                          className="chat-item-name"
                          onDoubleClick={() => startRename(chat)}
                        >
                          {chat.title}
                        </p>
                        <p className={`chat-item-meta ${isConfirmingDelete ? 'danger' : ''}`}>
                          {isConfirmingDelete ? 'Click trash again to delete' : getChatMeta(chat)}
                        </p>
                      </div>
                    </button>
                  )}

                  <div className="chat-item-side">
                    {!isConfirmingDelete ? <StatusBadge status={chat.status} /> : null}
                    <button
                      className="chat-delete-btn"
                      type="button"
                      aria-label={`Delete ${chat.title}`}
                      title={isConfirmingDelete ? 'Click again to confirm delete' : 'Delete chat'}
                      onClick={(event) => handleDeleteClick(event, chat)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="sidebar-footer">
          <div className="storage-card">
            <div className="storage-header">
              <span className="mono-label">Workspace</span>
              <span className="mono-label" style={{ color: 'white' }}>{chats.length}</span>
            </div>
            <div className="storage-copy">
              Double-click a title to rename it. Remove chats without affecting your stored documents.
            </div>
          </div>

          <div className="sidebar-meta">
            <span className="version-label">v1.2.0-beta</span>
          </div>
        </div>
      </aside>
    </>
  );
}
