/**
 * DocuMind API service.
 * Handles all communication with the backend REST API.
 */

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '');

/**
 * Upload a document file.
 * @param {File} file
 * @returns {Promise<object>}
 */
export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/api/documents/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || 'Upload failed');
  }

  return response.json();
}

/**
 * List all documents.
 * @returns {Promise<{documents: object[], total: number}>}
 */
export async function listDocuments() {
  const res = await fetch(`${BASE_URL}/api/documents/`);
  if (!res.ok) throw new Error('Failed to fetch documents');
  return res.json();
}

/**
 * Get a single document by ID.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getDocument(id) {
  const res = await fetch(`${BASE_URL}/api/documents/${id}`);
  if (!res.ok) throw new Error('Document not found');
  return res.json();
}

/**
 * Generate or fetch a structured summary for a document.
 * @param {string} id
 * @param {object} options
 * @param {string} [options.mode]
 * @param {boolean} [options.forceRefresh]
 * @returns {Promise<object>}
 */
export async function getDocumentSummary(id, { mode = 'standard', forceRefresh = false, question } = {}) {
  const res = await fetch(`${BASE_URL}/api/documents/${id}/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, force_refresh: forceRefresh, question }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to generate summary');
  }

  return res.json();
}

/**
 * Delete a document.
 * @param {string} id
 */
export async function deleteDocument(id) {
  const res = await fetch(`${BASE_URL}/api/documents/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Delete failed');
  }
  return res.json();
}

/**
 * Get a lightweight document status payload.
 * @param {string} id
 * @returns {Promise<{id: string, status: string}>}
 */
export async function getDocumentStatus(id) {
  const res = await fetch(`${BASE_URL}/api/documents/${id}/status`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch document status');
  }
  return res.json();
}

/**
 * Send a query with streaming SSE response.
 * @param {object} params
 * @param {string} params.question
 * @param {string[]} [params.document_ids]
 * @param {number} [params.top_k]
 * @param {boolean} [params.deep_scan]
 * @param {function} onToken - Called with each token string
 * @param {function} onCitation - Called with each citation object
 * @param {function} onMetadata - Called with metadata object
 * @param {function} onDone - Called with final summary
 * @param {function} onError - Called with error
 */
export async function queryStream({ question, document_ids, top_k = 5, deep_scan = true },
  { onToken, onCitation, onMetadata, onDone, onError }
) {
  const res = await fetch(`${BASE_URL}/api/query/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, document_ids, top_k, deep_scan }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Query failed');
  }

  if (!res.body) {
    throw new Error('Streaming response was unavailable');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6);
        switch (currentEvent) {
          case 'token':
            try {
              onToken?.(JSON.parse(data));
            } catch {
              onToken?.(data);
            }
            break;
          case 'citation':
            onCitation?.(JSON.parse(data));
            break;
          case 'metadata':
            onMetadata?.(JSON.parse(data));
            break;
          case 'done':
            onDone?.(JSON.parse(data));
            break;
          case 'error':
            onError?.(JSON.parse(data));
            break;
        }
      }
    }
  }
}

/**
 * Synchronous query (non-streaming).
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function querySyn({ question, document_ids, top_k = 5 }) {
  const res = await fetch(`${BASE_URL}/api/query/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, document_ids, top_k }),
  });
  if (!res.ok) throw new Error('Query failed');
  return res.json();
}

/**
 * Get analytics overview.
 * @returns {Promise<object>}
 */
export async function getAnalytics() {
  const res = await fetch(`${BASE_URL}/api/analytics/overview`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch analytics');
  }
  return res.json();
}

/**
 * Get the recent query history.
 * @returns {Promise<object[]>}
 */
export async function getQueryHistory() {
  const res = await fetch(`${BASE_URL}/api/analytics/queries`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch query history');
  }
  return res.json();
}

/**
 * Health check.
 * @returns {Promise<object>}
 */
export async function healthCheck() {
  const res = await fetch(`${BASE_URL}/api/health`);
  if (!res.ok) throw new Error('API unhealthy');
  return res.json();
}
