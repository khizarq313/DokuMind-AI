/**
 * Workspace page with delayed attachment send flow and persistent per-user chats.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, EllipsisVertical, FileText, Share2, Upload } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import ChatInput from '../components/ChatInput';
import DocumentSummaryPanel from '../components/DocumentSummaryPanel';
import ToastStack from '../components/ToastStack';
import { AIMessage, UserMessage } from '../components/ChatMessage';
import {
  deleteDocument,
  getDocument,
  getDocumentSummary,
  getDocumentStatus,
  listDocuments,
  queryStream,
  uploadDocument,
} from '../services/api';
import {
  appendStoredQueryLog,
  getStoredChatState,
  getStoredDocuments,
  mergeKnownDocuments,
  removeStoredDocumentReferences,
  saveStoredChatState,
  saveStoredDocuments,
} from '../utils/localStorage';
import './WorkspacePage.css';

const POLL_INTERVAL_MS = 5000;
const INDEX_STATUS_POLL_MS = 1500;
const INDEX_TIMEOUT_MS = 180000;
const DOCUMENT_SUGGESTIONS = [
  'Summarize this document',
  'Key insights',
  'Explain this file',
  'Important points',
];
const INDEXING_FAILED_MESSAGE = 'Document indexing failed. Try uploading it again.';
const DEFAULT_SUMMARY_MODE = 'normal';

function createId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function sortDocuments(documents) {
  return [...documents].sort((left, right) => (
    new Date(right.updated_at || right.created_at || 0).getTime()
    - new Date(left.updated_at || left.created_at || 0).getTime()
  ));
}

function sortChats(chats) {
  return [...chats].sort((left, right) => (
    new Date(right.lastActivityAt || right.createdAt || 0).getTime()
    - new Date(left.lastActivityAt || left.createdAt || 0).getTime()
  ));
}

function normalizeDocument(document, fallback = {}) {
  return {
    ...fallback,
    ...document,
    mime_type: document.mime_type || fallback.mime_type || 'application/pdf',
    created_at: document.created_at || fallback.created_at || new Date().toISOString(),
    updated_at: document.updated_at || document.created_at || fallback.updated_at || new Date().toISOString(),
    status: document.status || fallback.status || 'processing',
    isServerBacked: document.isServerBacked ?? fallback.isServerBacked ?? false,
  };
}

function createChatSession(overrides = {}) {
  const timestamp = new Date().toISOString();

  return {
    id: createId('chat'),
    title: 'New Chat',
    documentId: null,
    status: 'idle',
    messages: [],
    createdAt: timestamp,
    lastActivityAt: timestamp,
    readyAnnounced: false,
    isCustomTitle: false,
    pendingQuestion: null,
    ...overrides,
  };
}

function createChatFromDocument(document) {
  return createChatSession({
    id: createId('chat-doc'),
    title: document.filename,
    documentId: document.id,
    status: document.status,
    createdAt: document.created_at,
    lastActivityAt: document.updated_at || document.created_at,
    readyAnnounced: document.status === 'indexed',
  });
}

function createAssistantMessage(text, extra = {}) {
  return {
    id: createId('msg'),
    role: 'assistant',
    text,
    citations: [],
    latency: '',
    isStreaming: false,
    timestamp: new Date().toISOString(),
    summary: null,
    ...extra,
  };
}

function createUserMessage(text, extra = {}) {
  return {
    id: createId('msg'),
    role: 'user',
    text,
    timestamp: new Date().toISOString(),
    attachment: null,
    ...extra,
  };
}

function createAttachmentPayload(file) {
  return {
    name: file.name,
    sizeBytes: file.size,
    type: file.type || 'application/pdf',
  };
}

function formatMessageTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatLatency(latencyMs) {
  if (!latencyMs) {
    return '';
  }

  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(latencyMs)}ms`;
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

function isSummaryIntent(text = '') {
  const normalized = text.toLowerCase().trim();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes('summarize')
    || normalized.includes('summary')
    || normalized.includes('executive summary')
    || normalized.includes('key insights')
  );
}

function getChatStatusLabel(status) {
  if (status === 'indexed') {
    return 'Ready';
  }

  if (status === 'processing' || status === 'indexing' || status === 'uploading') {
    return 'Indexing';
  }

  if (status === 'failed') {
    return 'Failed';
  }

  return 'New chat';
}

function buildWorkspaceState(userId) {
  const storedDocuments = sortDocuments(
    getStoredDocuments(userId).map((document) => normalizeDocument(document)),
  );

  return {
    documents: storedDocuments,
    chatState: getStoredChatState(userId),
  };
}

export default function WorkspacePage({ user, isSidebarOpen = true, onSidebarOpenChange }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialWorkspaceState = useMemo(() => buildWorkspaceState(user?.id), [user?.id]);
  const [documents, setDocuments] = useState(initialWorkspaceState.documents);
  const [chatState, setChatState] = useState(initialWorkspaceState.chatState);
  const [draft, setDraft] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [summaryMode, setSummaryMode] = useState(DEFAULT_SUMMARY_MODE);
  const [summaryCache, setSummaryCache] = useState({});
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [tick, setTick] = useState(0);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const chatStateRef = useRef(chatState);
  const documentsRef = useRef(documents);
  const isUploadingRef = useRef(isUploading);
  const isQueryingRef = useRef(isQuerying);
  const chatInputRef = useRef(null);
  const workspaceMenuRef = useRef(null);

  useEffect(() => {
    document.title = 'DocuMind \u2013 Workspace';
  }, []);

  // Close workspace menu on outside click.
  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!workspaceMenuRef.current?.contains(event.target)) {
        setShowWorkspaceMenu(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    const nextWorkspaceState = buildWorkspaceState(user?.id);
    setDocuments(nextWorkspaceState.documents);
    setChatState(nextWorkspaceState.chatState);
    setDraft('');
    chatInputRef.current?.clearAttachment();
    setIsUploading(false);
    setIsQuerying(false);
    setSummaryMode(DEFAULT_SUMMARY_MODE);
    setSummaryCache({});
    setIsSummaryLoading(false);
    setSummaryError('');
  }, [user?.id]);

  useEffect(() => {
    chatStateRef.current = chatState;
  }, [chatState]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    isUploadingRef.current = isUploading;
  }, [isUploading]);

  useEffect(() => {
    isQueryingRef.current = isQuerying;
  }, [isQuerying]);

  useEffect(() => {
    if (user?.id) {
      saveStoredChatState(user.id, chatState);
    }
  }, [chatState, user?.id]);

  // Tick every 30 s so relative timestamps re-render automatically.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (user?.id) {
      saveStoredDocuments(user.id, documents);
    }
  }, [documents, user?.id]);

  const pushToast = useCallback((message, tone = 'info') => {
    const toastId = createId('toast');
    setToasts((current) => [...current, { id: toastId, message, tone }]);

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== toastId));
    }, 3200);
  }, []);

  const appendAssistantMessage = useCallback((chatId, text, extra = {}) => {
    setChatState((current) => ({
      ...current,
      chats: sortChats(current.chats.map((chat) => (
        chat.id === chatId
          ? {
            ...chat,
            lastActivityAt: new Date().toISOString(),
            messages: [...chat.messages, createAssistantMessage(text, extra)],
          }
          : chat
      ))),
    }));
  }, []);

  const ensureAssistantMessage = useCallback((chatId, text) => {
    setChatState((current) => ({
      ...current,
      chats: sortChats(current.chats.map((chat) => {
        if (chat.id !== chatId) {
          return chat;
        }

        const lastMessage = chat.messages[chat.messages.length - 1];
        if (lastMessage?.role === 'assistant' && lastMessage.text === text) {
          return chat;
        }

        return {
          ...chat,
          lastActivityAt: new Date().toISOString(),
          messages: [...chat.messages, createAssistantMessage(text)],
        };
      })),
    }));
  }, []);

  const appendUserMessage = useCallback((chatId, text, extra = {}) => {
    setChatState((current) => ({
      ...current,
      chats: sortChats(current.chats.map((chat) => (
        chat.id === chatId
          ? {
            ...chat,
            lastActivityAt: new Date().toISOString(),
            messages: [...chat.messages, createUserMessage(text, extra)],
          }
          : chat
      ))),
    }));
  }, []);

  const updateMessage = useCallback((chatId, messageId, updater) => {
    setChatState((current) => ({
      ...current,
      chats: current.chats.map((chat) => (
        chat.id === chatId
          ? {
            ...chat,
            messages: chat.messages.map((message) => (
              message.id === messageId ? updater(message) : message
            )),
          }
          : chat
      )),
    }));
  }, []);

  const updateChatMeta = useCallback((chatId, updater) => {
    setChatState((current) => ({
      ...current,
      chats: sortChats(current.chats.map((chat) => (
        chat.id === chatId ? updater(chat) : chat
      ))),
    }));
  }, []);

  const deleteChat = useCallback((chatId) => {
    const chatToDelete = chatStateRef.current.chats.find((chat) => chat.id === chatId);
    if (!chatToDelete) {
      return;
    }

    if (!chatToDelete.documentId) {
      setChatState((current) => {
        const chats = current.chats.filter((chat) => chat.id !== chatId);
        const activeChatId = current.activeChatId === chatId
          ? chats[0]?.id || null
          : current.activeChatId;

        return { chats, activeChatId };
      });
      return;
    }

    const docId = chatToDelete.documentId;
    const documentEntry = documentsRef.current.find((document) => document.id === docId);
    if (documentEntry?.isServerBacked) {
      void deleteDocument(docId).catch(() => null);
    }

    removeStoredDocumentReferences(user?.id, docId);
    setDocuments((current) => current.filter((document) => document.id !== docId));
    setSummaryCache((current) => {
      const next = { ...current };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${docId}:`)) {
          delete next[key];
        }
      });
      return next;
    });
    setChatState((current) => {
      const chats = current.chats.filter((chat) => chat.documentId !== docId);
      const activeChatId = chats.some((chat) => chat.id === current.activeChatId)
        ? current.activeChatId
        : chats[0]?.id || null;
      return { chats, activeChatId };
    });
  }, [user?.id]);

  const clearAllChats = useCallback(() => {
    const documentIds = Array.from(
      new Set(
        chatStateRef.current.chats
          .map((chat) => chat.documentId)
          .filter(Boolean),
      ),
    );
    documentIds.forEach((docId) => {
      const documentEntry = documentsRef.current.find((document) => document.id === docId);
      if (documentEntry?.isServerBacked) {
        void deleteDocument(docId).catch(() => null);
      }
      removeStoredDocumentReferences(user?.id, docId);
    });

    setSummaryCache({});
    setDocuments((current) => current.filter((document) => !documentIds.includes(document.id)));
    setChatState({ chats: [], activeChatId: null });
  }, [user?.id]);

  const renameChat = useCallback((chatId, newTitle) => {
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    setChatState((current) => ({
      ...current,
      chats: current.chats.map((chat) => (
        chat.id === chatId ? { ...chat, title: trimmedTitle, isCustomTitle: true } : chat
      )),
    }));
  }, []);

  const runQuestion = useCallback(async (
    chatId,
    question,
    deepScan,
    options = { appendUser: true },
  ) => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return false;
    }

    if (isUploadingRef.current || isQueryingRef.current) {
      return false;
    }

    const currentChat = chatStateRef.current.chats.find((chat) => chat.id === chatId);
    if (!currentChat?.documentId) {
      pushToast('Attach a PDF or open an indexed document before asking a question.', 'info');
      return false;
    }

    const currentDocument = documentsRef.current.find((document) => document.id === currentChat.documentId);
    if (currentDocument && currentDocument.isServerBacked === false) {
      pushToast('This document only exists in local history. Re-upload it to query again.', 'error');
      return false;
    }

    if (
      currentChat.status === 'processing'
      || currentChat.status === 'indexing'
      || currentChat.status === 'uploading'
    ) {
      ensureAssistantMessage(chatId, 'Indexing document...');
      pushToast('Indexing document...', 'info');
      return false;
    }

    if (currentChat.status === 'failed') {
      pushToast('This document is not ready. Upload it again to retry.', 'error');
      return false;
    }

    const queryId = createId('query');
    const streamingMessageId = createId('msg');
    let collectedCitations = [];
    let streamError = null;
    let completionSummary = null;

    if (options.appendUser !== false) {
      appendUserMessage(chatId, trimmedQuestion);
    }

    if (summaryMode !== 'normal') {
      // For non-normal modes, generate summary instead of query
      setChatState((current) => ({
        ...current,
        chats: sortChats(current.chats.map((chat) => (
          chat.id === chatId
            ? {
              ...chat,
              lastActivityAt: new Date().toISOString(),
              messages: [
                ...chat.messages,
                createAssistantMessage('', { id: streamingMessageId, isStreaming: true, isSummaryMessage: true, documentName: currentDocument.filename }),
              ],
            }
            : chat
        ))),
      }));

      setIsQuerying(true);

      try {
        const summary = await getDocumentSummary(currentDocument.id, {
          mode: summaryMode,
          forceRefresh: false,
          question: trimmedQuestion,
        });
        updateMessage(chatId, streamingMessageId, (message) => ({
          ...message,
          summary,
          text: '',
          isStreaming: false,
        }));
        appendStoredQueryLog(user?.id, {
          query_id: queryId,
          query_text: trimmedQuestion,
          timestamp: new Date().toISOString(),
          latency_ms: 0,
          confidence: summary.confidence || 0,
          status: 'success',
          citation_count: 0,
        });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate summary.';
        updateMessage(chatId, streamingMessageId, (message) => ({
          ...message,
          text: message,
          isStreaming: false,
        }));
        appendStoredQueryLog(user?.id, {
          query_id: queryId,
          query_text: trimmedQuestion,
          timestamp: new Date().toISOString(),
          latency_ms: 0,
          confidence: 0,
          status: 'error',
          citation_count: 0,
        });
        pushToast(message, 'error');
        return false;
      } finally {
        setIsQuerying(false);
      }
    }

    setChatState((current) => ({
      ...current,
      chats: sortChats(current.chats.map((chat) => (
        chat.id === chatId
          ? {
            ...chat,
            lastActivityAt: new Date().toISOString(),
            messages: [
              ...chat.messages,
              createAssistantMessage('', { id: streamingMessageId, isStreaming: true }),
            ],
          }
          : chat
      ))),
    }));

    setIsQuerying(true);

    try {
      await queryStream(
        {
          question: trimmedQuestion,
          document_ids: [currentChat.documentId],
          deep_scan: deepScan,
        },
        {
          onToken: (token) => {
            updateMessage(chatId, streamingMessageId, (message) => ({
              ...message,
              text: `${message.text}${token}`,
            }));
          },
          onCitation: (citation) => {
            collectedCitations = [...collectedCitations, citation];
            updateMessage(chatId, streamingMessageId, (message) => ({
              ...message,
              citations: collectedCitations,
            }));
          },
          onDone: (summary) => {
            completionSummary = summary;
          },
          onError: (payload) => {
            streamError = payload?.message || 'The response stream ended with an error.';
          },
        },
      );

      if (streamError) {
        updateMessage(chatId, streamingMessageId, (message) => ({
          ...message,
          text: streamError,
          citations: [],
          latency: '',
          isStreaming: false,
        }));
        appendStoredQueryLog(user?.id, {
          query_id: queryId,
          query_text: trimmedQuestion,
          timestamp: new Date().toISOString(),
          latency_ms: 0,
          confidence: 0,
          status: 'error',
          citation_count: 0,
        });
        pushToast(streamError, 'error');
        return false;
      }

      const latencyMs = completionSummary?.latency_ms || 0;
      const confidence = completionSummary?.confidence || 0;

      updateMessage(chatId, streamingMessageId, (message) => ({
        ...message,
        citations: collectedCitations,
        latency: formatLatency(latencyMs),
        isStreaming: false,
      }));

      appendStoredQueryLog(user?.id, {
        query_id: queryId,
        query_text: trimmedQuestion,
        timestamp: new Date().toISOString(),
        latency_ms: latencyMs,
        confidence,
        status: 'success',
        citation_count: collectedCitations.length,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to query the document.';
      updateMessage(chatId, streamingMessageId, (streamingMessage) => ({
        ...streamingMessage,
        text: message,
        citations: [],
        latency: '',
        isStreaming: false,
      }));
      appendStoredQueryLog(user?.id, {
        query_id: queryId,
        query_text: trimmedQuestion,
        timestamp: new Date().toISOString(),
        latency_ms: 0,
        confidence: 0,
        status: 'error',
        citation_count: 0,
      });
      pushToast(message, 'error');
      return false;
    } finally {
      setIsQuerying(false);
    }
  }, [appendUserMessage, ensureAssistantMessage, pushToast, updateMessage, user?.id, summaryMode]);

  const reconcileChatsWithDocuments = useCallback((nextDocuments, announceTransitions = true) => {
    const actions = [];

    setChatState((current) => {
      const nextDocumentsById = new Map(nextDocuments.map((document) => [document.id, document]));
      const nextChats = [];

      current.chats.forEach((chat) => {
        if (!chat.documentId) {
          nextChats.push(chat);
          return;
        }

        const document = nextDocumentsById.get(chat.documentId);
        if (!document) {
          if (
            String(chat.documentId).startsWith('pending-doc')
            || chat.status === 'uploading'
            || chat.status === 'processing'
            || chat.status === 'indexing'
            || !chat.documentId
          ) {
            nextChats.push(chat);
          }
          return;
        }

        const statusChanged = chat.status !== document.status;
        const readyTransition = (
          announceTransitions
          && document.status === 'indexed'
          && statusChanged
          && !chat.readyAnnounced
        );
        const failedTransition = announceTransitions && document.status === 'failed' && statusChanged;

        if (readyTransition) {
          actions.push({
            type: 'ready',
            chatId: chat.id,
            filename: document.filename,
          });
        }

        if (failedTransition) {
          actions.push({
            type: 'failed',
            chatId: chat.id,
          });
        }

        nextChats.push({
          ...chat,
          title: chat.isCustomTitle ? chat.title : document.filename,
          documentId: document.id,
          status: document.status,
          // Preserve the more-recent of the chat's own activity vs. the document timestamp
          lastActivityAt: (chat.lastActivityAt || '') > (document.updated_at || '')
            ? chat.lastActivityAt
            : (document.updated_at || chat.lastActivityAt),
          readyAnnounced: chat.readyAnnounced || document.status === 'indexed',
        });
      });

      const activeChatId = nextChats.some((chat) => chat.id === current.activeChatId)
        ? current.activeChatId
        : nextChats[0]?.id || null;

      return {
        chats: sortChats(nextChats),
        activeChatId,
      };
    });

    actions.forEach((action) => {
      if (action.type === 'ready') {
        pushToast('Document ready for queries.', 'success');
      }

      if (action.type === 'failed') {
        ensureAssistantMessage(action.chatId, INDEXING_FAILED_MESSAGE);
        pushToast('Document indexing failed.', 'error');
      }
    });
  }, [ensureAssistantMessage, pushToast]);

  const refreshDocuments = useCallback(async (announceTransitions = true) => {
    try {
      const response = await listDocuments();
      const apiDocuments = (response.documents || []).map((document) => (
        normalizeDocument(document, { isServerBacked: true })
      ));
      const mergedDocuments = sortDocuments(
        mergeKnownDocuments(apiDocuments, documentsRef.current).map((document) => normalizeDocument(document)),
      );

      setDocuments(mergedDocuments);
      reconcileChatsWithDocuments(mergedDocuments, announceTransitions);
      return mergedDocuments;
    } catch {
      return null;
    }
  }, [reconcileChatsWithDocuments]);

  const waitForDocumentIndexing = useCallback(async (documentId, chatId, fallbackName) => {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < INDEX_TIMEOUT_MS) {
      try {
        const statusPayload = await getDocumentStatus(documentId);

        updateChatMeta(chatId, (chat) => ({
          ...chat,
          documentId,
          status: statusPayload.status,
          lastActivityAt: new Date().toISOString(),
        }));

        if (statusPayload.status === 'indexed' || statusPayload.status === 'failed') {
          const fullDocument = await getDocument(documentId).catch(() => null);
          const normalizedDocument = normalizeDocument(fullDocument || {
            id: documentId,
            filename: fallbackName,
            status: statusPayload.status,
          }, { isServerBacked: true });

          setDocuments((current) => sortDocuments(
            mergeKnownDocuments([normalizedDocument], current).map((document) => normalizeDocument(document)),
          ));

          return normalizedDocument;
        }
      } catch (error) {
        lastError = error;
      }

      await sleep(INDEX_STATUS_POLL_MS);
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error('Document indexing timed out. Please try again.');
  }, [updateChatMeta]);

  useEffect(() => {
    let isDisposed = false;

    const loadDocuments = async (announceTransitions) => {
      if (!isDisposed) {
        await refreshDocuments(announceTransitions);
      }
    };

    void loadDocuments(false);

    const intervalId = window.setInterval(() => {
      void loadDocuments(true);
    }, POLL_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, [refreshDocuments]);

  useEffect(() => {
    const targetDocId = searchParams.get('docId');
    if (!targetDocId) {
      return;
    }

    const targetChat = chatState.chats.find((chat) => chat.documentId === targetDocId);
    if (!targetChat) {
      return;
    }

    if (chatState.activeChatId !== targetChat.id) {
      setChatState((current) => ({ ...current, activeChatId: targetChat.id }));
    }

    setSearchParams({}, { replace: true });
  }, [chatState.activeChatId, chatState.chats, searchParams, setSearchParams]);

  useEffect(() => {
    const targetDocId = searchParams.get('docId');
    if (!targetDocId) {
      return;
    }

    if (chatState.chats.some((chat) => chat.documentId === targetDocId)) {
      return;
    }

    const targetDocument = documents.find((document) => document.id === targetDocId);
    if (!targetDocument) {
      return;
    }

    const nextChat = createChatFromDocument(targetDocument);
    setChatState((current) => ({
      chats: sortChats([nextChat, ...current.chats]),
      activeChatId: nextChat.id,
    }));
  }, [chatState.chats, documents, searchParams]);

  useEffect(() => {
    const queuedChat = chatState.chats.find((chat) => (
      chat.status === 'indexed'
      && chat.pendingQuestion?.text
      && !isQueryingRef.current
    ));

    if (!queuedChat) {
      return;
    }

    const { text, deepScan } = queuedChat.pendingQuestion;
    updateChatMeta(queuedChat.id, (chat) => ({ ...chat, pendingQuestion: null }));
    window.setTimeout(() => {
      void runQuestion(queuedChat.id, text, deepScan, { appendUser: false });
    }, 0);
  }, [chatState.chats, runQuestion, updateChatMeta]);

  const activeChat = useMemo(
    () => chatState.chats.find((chat) => chat.id === chatState.activeChatId) || null,
    [chatState],
  );

  const activeDocument = useMemo(
    () => documents.find((document) => document.id === activeChat?.documentId) || null,
    [activeChat?.documentId, documents],
  );

  const indexedSourcesCount = useMemo(
    () => documents.filter((document) => document.status === 'indexed' && document.isServerBacked !== false).length,
    [documents],
  );

  const activeMessages = activeChat?.messages || [];
  const activeDocName = activeDocument?.filename || activeChat?.title || 'New Chat';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeDocModified = useMemo(() => (activeDocument ? formatRelativeTime(activeDocument.updated_at) : 'Awaiting upload'), [activeDocument, tick]);
  const suggestions = DOCUMENT_SUGGESTIONS;
  const showFirstRunWelcome = chatState.chats.length === 0;
  const showCenteredUpload = showFirstRunWelcome || (!activeChat?.documentId && activeMessages.length === 0);
  const isIndexing = activeChat?.status === 'indexing' || activeChat?.status === 'processing' || activeChat?.status === 'uploading';
  const isStructuredSummaryMode = summaryMode !== 'normal';

  const composerStatusText = useMemo(() => {
    if (isUploading) {
      return 'Uploading document...';
    }

    if (isQuerying) {
      return 'Generating grounded answer...';
    }

    if (activeChat?.status === 'failed') {
      return 'This upload failed. Add the file again to retry.';
    }

    if (
      activeChat?.status === 'processing'
      || activeChat?.status === 'indexing'
      || activeChat?.status === 'uploading'
    ) {
      return 'Indexing document...';
    }

    if (!activeChat?.documentId) {
      return '';
    }

    if (activeDocument?.isServerBacked === false) {
      return 'This document is stored locally only. Re-upload it to query again.';
    }

    return `Ready on ${activeDocName}`;
  }, [activeChat, activeDocName, activeDocument?.isServerBacked, isQuerying, isUploading]);

  const loadSummary = useCallback(async (forceRefresh = false, question = null) => {
    if (
      !activeDocument?.id
      || activeChat?.status !== 'indexed'
      || activeDocument?.isServerBacked === false
    ) {
      return;
    }

    // 'normal' is a RAG-query mode; map it to 'standard' for structured summary generation
    const apiMode = summaryMode === 'normal' ? 'standard' : summaryMode;
    const cacheKey = question ? `${activeDocument.id}:${apiMode}:${question}` : `${activeDocument.id}:${apiMode}`;
    if (!forceRefresh && summaryCache[cacheKey]) {
      setSummaryError('');
      return;
    }

    setIsSummaryLoading(true);
    setSummaryError('');

    try {
      const summary = await getDocumentSummary(activeDocument.id, {
        mode: apiMode,
        forceRefresh,
        question,
      });
      setSummaryCache((current) => ({
        ...current,
        [cacheKey]: summary,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate summary.';
      setSummaryError(message);
    } finally {
      setIsSummaryLoading(false);
    }
  }, [
    activeChat?.status,
    activeDocument?.id,
    activeDocument?.isServerBacked,
    summaryCache,
    summaryMode,
  ]);

  const closeSidebarOnMobile = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      onSidebarOpenChange?.(false);
    }
  }, [onSidebarOpenChange]);

  const handleNewChat = useCallback(() => {
    // If the active chat is already a fresh empty chat, just focus it — don't create another
    const currentActive = chatStateRef.current.chats.find(
      (c) => c.id === chatStateRef.current.activeChatId,
    );
    if (currentActive && currentActive.messages.length === 0 && !currentActive.documentId) {
      closeSidebarOnMobile();
      return;
    }

    const nextChat = createChatSession();
    setChatState((current) => ({
      chats: sortChats([nextChat, ...current.chats]),
      activeChatId: nextChat.id,
    }));
    setDraft('');
    chatInputRef.current?.clearAttachment();
    closeSidebarOnMobile();
  }, [closeSidebarOnMobile]);

  const handleChatSelect = useCallback((chatId) => {
    setChatState((current) => {
      const currentActive = current.chats.find((c) => c.id === current.activeChatId);
      // If switching away from an empty unsent chat, silently remove it
      const shouldRemoveEmpty = (
        currentActive
        && current.activeChatId !== chatId
        && currentActive.messages.length === 0
        && !currentActive.documentId
      );
      return {
        activeChatId: chatId,
        chats: shouldRemoveEmpty
          ? current.chats.filter((c) => c.id !== current.activeChatId)
          : current.chats,
      };
    });
  }, []);

  const handleSendWithFile = useCallback(async (question, file, deepScan) => {
    if (isUploadingRef.current) {
      return false;
    }

    const trimmedQuestion = question.trim();
    const timestamp = new Date().toISOString();
    const attachment = createAttachmentPayload(file);

    // Always reuse the current active chat. If none exists, create one.
    const currentActiveChat = chatStateRef.current.chats.find(
      (chat) => chat.id === chatStateRef.current.activeChatId,
    );
    // If the chat already had a document, don't rename it on the new upload.
    const wasExistingDocChat = !!(currentActiveChat?.documentId);

    const newMessages = [
      ...(trimmedQuestion ? [createUserMessage(trimmedQuestion, { attachment, timestamp })] : []),
      createAssistantMessage('Uploading and indexing your PDF...'),
    ];

    let targetChatId;

    if (currentActiveChat) {
      targetChatId = currentActiveChat.id;
      // Update in-place: keep all prior messages, append new ones, reset doc state
      setChatState((current) => ({
        ...current,
        chats: sortChats(current.chats.map((chat) => (
          chat.id === targetChatId
            ? {
              ...chat,
              title: (chat.isCustomTitle || wasExistingDocChat) ? chat.title : file.name,
              status: 'uploading',
              // Keep existing documentId during upload to avoid race with reconcileChatsWithDocuments;
              // it will be atomically swapped to the new doc ID after upload completes.
              lastActivityAt: timestamp,
              messages: [...chat.messages, ...newMessages],
              pendingQuestion: trimmedQuestion ? { text: trimmedQuestion, deepScan } : null,
            }
            : chat
        ))),
      }));
    } else {
      const freshChat = createChatSession({
        title: file.name,
        status: 'uploading',
        lastActivityAt: timestamp,
        messages: newMessages,
        pendingQuestion: trimmedQuestion ? { text: trimmedQuestion, deepScan } : null,
      });
      targetChatId = freshChat.id;
      setChatState((current) => ({
        chats: sortChats([freshChat, ...current.chats]),
        activeChatId: freshChat.id,
      }));
    }

    closeSidebarOnMobile();

    void (async () => {
      let uploadedDocument = null;

      try {
        setIsUploading(true);
        uploadedDocument = normalizeDocument(await uploadDocument(file), {
          mime_type: 'application/pdf',
          size_bytes: file.size,
          created_at: timestamp,
          updated_at: new Date().toISOString(),
          isServerBacked: true,
        });

        setDocuments((current) => sortDocuments(
          mergeKnownDocuments([uploadedDocument], current).map((document) => normalizeDocument(document)),
        ));
        updateChatMeta(targetChatId, (chat) => ({
          ...chat,
          title: (chat.isCustomTitle || wasExistingDocChat) ? chat.title : uploadedDocument.filename,
          documentId: uploadedDocument.id,
          status: uploadedDocument.status,
          lastActivityAt: uploadedDocument.updated_at || new Date().toISOString(),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Document upload failed.';
        updateChatMeta(targetChatId, (chat) => ({
          ...chat,
          status: 'failed',
          pendingQuestion: null,
          lastActivityAt: new Date().toISOString(),
        }));
        appendAssistantMessage(targetChatId, message);
        pushToast(message, 'error');
        return;
      } finally {
        setIsUploading(false);
      }

      try {
        const finalDocument = await waitForDocumentIndexing(
          uploadedDocument.id,
          targetChatId,
          uploadedDocument.filename,
        );

        if (finalDocument.status === 'failed') {
          updateChatMeta(targetChatId, (chat) => ({
            ...chat,
            status: 'failed',
            pendingQuestion: null,
            lastActivityAt: finalDocument.updated_at || new Date().toISOString(),
          }));
          ensureAssistantMessage(targetChatId, INDEXING_FAILED_MESSAGE);
          pushToast('Document indexing failed.', 'error');
          return;
        }

        updateChatMeta(targetChatId, (chat) => ({
          ...chat,
          title: (chat.isCustomTitle || wasExistingDocChat) ? chat.title : finalDocument.filename,
          documentId: finalDocument.id,
          status: finalDocument.status,
          lastActivityAt: finalDocument.updated_at || new Date().toISOString(),
          readyAnnounced: true,
        }));
        pushToast('Document ready for queries.', 'success');
        await refreshDocuments(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : INDEXING_FAILED_MESSAGE;
        updateChatMeta(targetChatId, (chat) => ({
          ...chat,
          status: 'failed',
          pendingQuestion: null,
          lastActivityAt: new Date().toISOString(),
        }));
        ensureAssistantMessage(targetChatId, message);
        pushToast(message, 'error');
      }
    })();

    return true;
  }, [
    appendAssistantMessage,
    closeSidebarOnMobile,
    ensureAssistantMessage,
    pushToast,
    refreshDocuments,
    updateChatMeta,
    waitForDocumentIndexing,
  ]);

  const handleSendMessage = useCallback(async (question, deepScan) => {
    if (isUploadingRef.current) {
      return false;
    }

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return false;
    }

    const currentChat = chatStateRef.current.chats.find((chat) => chat.id === chatStateRef.current.activeChatId);
    if (!currentChat) {
      pushToast('Attach a PDF or open a chat before sending a question.', 'info');
      return false;
    }

    return runQuestion(currentChat.id, trimmedQuestion, deepScan, { appendUser: true });
  }, [pushToast, runQuestion]);

  const handleRefreshSummary = useCallback(() => {
    void loadSummary(true);
  }, [loadSummary]);

  const isUserRole = (role) => role === 'user';

  return (
    <div className={`workspace-layout ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <Sidebar
        chats={chatState.chats}
        activeChatId={chatState.activeChatId}
        isOpen={isSidebarOpen}
        onChatSelect={handleChatSelect}
        onClose={() => onSidebarOpenChange?.(false)}
        onNewChat={handleNewChat}
        onDeleteChat={deleteChat}
        onRenameChat={renameChat}
        onClearAllChats={clearAllChats}
      />

      <main className="workspace-main animate-fade-in">
        <div className="workspace-breadcrumb">
          <div className="breadcrumb-path">
            <span className="breadcrumb-root">Workspace</span>
            <ChevronRight size={14} className="breadcrumb-sep" />
            <span className="breadcrumb-current">{activeDocName}</span>
            <span className="chip chip-primary breadcrumb-badge">
              {indexedSourcesCount} sources active
            </span>
          </div>

          <div className="breadcrumb-actions">
            <span className={`chip breadcrumb-status ${activeChat?.status === 'indexed' ? 'chip-secondary' : activeChat?.status === 'failed' ? 'chip-error' : 'chip-warning'}`}>
              {getChatStatusLabel(activeChat?.status)}
            </span>
            <button className="btn-icon breadcrumb-share-btn" type="button" aria-label="Share conversation">
              <Share2 size={16} />
            </button>
            <div className="workspace-menu-anchor" ref={workspaceMenuRef}>
              <button
                className="btn-icon"
                type="button"
                aria-label="More workspace options"
                onClick={() => setShowWorkspaceMenu((v) => !v)}
              >
                <EllipsisVertical size={16} />
              </button>
              {showWorkspaceMenu && (
                <div className="workspace-menu-dropdown">
                  <button className="workspace-menu-item" type="button" onClick={() => setShowWorkspaceMenu(false)}>
                    <span className="workspace-menu-icon">&#128203;</span>
                    Copy link
                  </button>
                  <button className="workspace-menu-item" type="button" onClick={() => setShowWorkspaceMenu(false)}>
                    <span className="workspace-menu-icon">&#128278;</span>
                    Bookmark chat
                  </button>
                  <button className="workspace-menu-item" type="button" onClick={() => setShowWorkspaceMenu(false)}>
                    <span className="workspace-menu-icon">&#9881;</span>
                    Chat settings
                  </button>
                  <div className="workspace-menu-divider" />
                  <button
                    className="workspace-menu-item workspace-menu-item-danger"
                    type="button"
                    onClick={() => { setShowWorkspaceMenu(false); setShowDeleteConfirm(true); }}
                    disabled={!activeChat}
                  >
                    <span className="workspace-menu-icon">&#128465;</span>
                    Delete chat
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="chat-scroll-area">
          {showCenteredUpload ? (
            <div className="workspace-empty-state">
              <div className="workspace-empty-card animate-fade-in">
                <span className="mono-label workspace-empty-label">Document-aware assistant</span>
                <h1 className="workspace-empty-title">
                  {showFirstRunWelcome ? `Welcome, ${user?.name} \ud83d\udc4b` : 'Attach a PDF to start'}
                </h1>
                <p className="workspace-empty-copy">
                  {showFirstRunWelcome
                    ? 'Attach a PDF, add an optional prompt, and send when you are ready. DocuMind will index the file in the background and answer with grounded citations.'
                    : 'Attach a PDF in the composer below. The chat will be created when you send it.'}
                </p>

                <button
                  type="button"
                  className="workspace-upload-button"
                  onClick={() => chatInputRef.current?.openFilePicker()}
                  disabled={isUploading}
                  id="workspace-center-upload"
                >
                  <Upload size={18} />
                  <span>{isUploading ? 'Uploading...' : 'Upload PDF'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="workspace-content-stack">
              <div className="chat-messages">
                {activeMessages.map((message) => {
                  const messageNode = isUserRole(message.role) ? (
                    <UserMessage
                      key={message.id}
                      text={message.text}
                      time={formatMessageTime(message.timestamp)}
                      attachment={message.attachment}
                      userInitial={user?.name?.[0]?.toUpperCase() || '?'}
                    />
                  ) : message.isSummaryMessage && !message.summary ? (
                    <DocumentSummaryPanel
                      key={message.id}
                      documentName={message.documentName || activeDocName}
                      documentStatus={activeChat?.status}
                      mode={summaryMode}
                      onModeChange={setSummaryMode}
                      onRefresh={handleRefreshSummary}
                      summary={null}
                      isLoading={true}
                      error={null}
                    />
                  ) : message.summary ? (
                    <DocumentSummaryPanel
                      key={message.id}
                      documentName={message.summary.document_name || message.documentName || activeDocName}
                      documentStatus={activeChat?.status}
                      mode={summaryMode}
                      onModeChange={setSummaryMode}
                      onRefresh={handleRefreshSummary}
                      summary={message.summary}
                      isLoading={false}
                      error={null}
                    />
                  ) : (
                    <AIMessage
                      key={message.id}
                      text={message.text}
                      citations={message.citations}
                      latency={message.latency}
                      isStreaming={message.isStreaming}
                    />
                  );

                  return messageNode;
                })}
              </div>
            </div>
          )}
        </div>

        <ChatInput
          ref={chatInputRef}
          value={draft}
          onValueChange={setDraft}
          onSend={handleSendMessage}
          onSendWithFile={handleSendWithFile}
          disabled={isQuerying || isIndexing}
          activeDoc={activeDocument?.filename || activeChat?.title}
          isUploading={isUploading}
          suggestions={suggestions}
          statusText={composerStatusText}
          summaryMode={summaryMode}
          onSummaryModeChange={setSummaryMode}
        />
      </main>

      <ToastStack toasts={toasts} />

      {showDeleteConfirm && createPortal(
        <div
          className="logout-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="logout-dialog-icon">🗑️</div>
            <h3 className="logout-dialog-title">Delete this chat?</h3>
            <p className="logout-dialog-copy">
              This chat and its associated document will be permanently removed. This cannot be undone.
            </p>
            <div className="logout-dialog-actions">
              <button
                className="logout-btn logout-btn-cancel"
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="logout-btn logout-btn-confirm"
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  if (activeChat) {
                    deleteChat(activeChat.id);
                  }
                }}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
