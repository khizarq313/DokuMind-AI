export const USER_STORAGE_KEY = 'documind_user';
const LEGACY_CHAT_KEY = 'documind_chats';
const LEGACY_DOCUMENT_KEY = 'documind_documents';

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getStoredUser() {
  const user = parseJson(localStorage.getItem(USER_STORAGE_KEY), null);

  if (!user?.id || !user?.name) {
    return null;
  }

  return user;
}

export function saveStoredUser(user) {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function getUserChatStorageKey(userId) {
  return `documind_chats_${userId}`;
}

export function getUserDocumentStorageKey(userId) {
  return `documind_documents_${userId}`;
}

export function getUserFavoritesStorageKey(userId) {
  return `documind_favorites_${userId}`;
}

export function getUserQueryLogStorageKey(userId) {
  return `documind_query_log_${userId}`;
}

export function getStoredChatState(userId) {
  if (!userId) {
    return { chats: [], activeChatId: null };
  }

  const stored = parseJson(localStorage.getItem(getUserChatStorageKey(userId)), null);
  if (!stored || !Array.isArray(stored.chats)) {
    return { chats: [], activeChatId: null };
  }

  return {
    chats: stored.chats,
    activeChatId: stored.activeChatId || stored.chats[0]?.id || null,
  };
}

export function saveStoredChatState(userId, chatState) {
  if (!userId) {
    return;
  }

  localStorage.setItem(getUserChatStorageKey(userId), JSON.stringify(chatState));
}

export function getStoredDocuments(userId) {
  if (!userId) {
    return [];
  }

  const stored = parseJson(localStorage.getItem(getUserDocumentStorageKey(userId)), []);
  return Array.isArray(stored) ? stored : [];
}

export function saveStoredDocuments(userId, documents) {
  if (!userId) {
    return;
  }

  localStorage.setItem(getUserDocumentStorageKey(userId), JSON.stringify(documents));
}

export function getStoredFavorites(userId) {
  if (!userId) {
    return [];
  }

  const stored = parseJson(localStorage.getItem(getUserFavoritesStorageKey(userId)), []);
  return Array.isArray(stored) ? stored : [];
}

export function saveStoredFavorites(userId, favorites) {
  if (!userId) {
    return;
  }

  localStorage.setItem(getUserFavoritesStorageKey(userId), JSON.stringify(favorites));
}

export function getStoredQueryLog(userId) {
  if (!userId) {
    return [];
  }

  const stored = parseJson(localStorage.getItem(getUserQueryLogStorageKey(userId)), []);
  return Array.isArray(stored) ? stored : [];
}

export function appendStoredQueryLog(userId, entry, limit = 50) {
  if (!userId) {
    return [];
  }

  const nextLog = [entry, ...getStoredQueryLog(userId)].slice(0, limit);
  localStorage.setItem(getUserQueryLogStorageKey(userId), JSON.stringify(nextLog));
  return nextLog;
}

export function mergeKnownDocuments(apiDocuments = [], storedDocuments = []) {
  const mergedById = new Map();

  storedDocuments.forEach((document) => {
    mergedById.set(document.id, {
      ...document,
      isServerBacked: Boolean(document.isServerBacked),
    });
  });

  apiDocuments.forEach((document) => {
    const previous = mergedById.get(document.id) || {};
    mergedById.set(document.id, {
      ...previous,
      ...document,
      isServerBacked: true,
    });
  });

  return Array.from(mergedById.values());
}

export function removeStoredDocumentReferences(userId, documentId) {
  if (!userId || !documentId) {
    return;
  }

  const documents = getStoredDocuments(userId).filter((document) => document.id !== documentId);
  saveStoredDocuments(userId, documents);

  const favorites = getStoredFavorites(userId).filter((favoriteId) => favoriteId !== documentId);
  saveStoredFavorites(userId, favorites);

  const chatState = getStoredChatState(userId);
  const chats = chatState.chats.filter((chat) => chat.documentId !== documentId);
  const activeChatId = chats.some((chat) => chat.id === chatState.activeChatId)
    ? chatState.activeChatId
    : chats[0]?.id || null;

  saveStoredChatState(userId, { chats, activeChatId });
}

export function clearStoredSession(userId) {
  localStorage.removeItem(USER_STORAGE_KEY);
  localStorage.removeItem(LEGACY_CHAT_KEY);
  localStorage.removeItem(LEGACY_DOCUMENT_KEY);

  if (userId) {
    localStorage.removeItem(getUserChatStorageKey(userId));
    localStorage.removeItem(getUserDocumentStorageKey(userId));
    localStorage.removeItem(getUserFavoritesStorageKey(userId));
    localStorage.removeItem(getUserQueryLogStorageKey(userId));
  }
}
