import { Bot, FileText, ThumbsDown, ThumbsUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import './ChatMessage.css';

function formatAttachmentSize(sizeBytes) {
  if (!sizeBytes) {
    return 'PDF';
  }

  if (sizeBytes >= 1_000_000) {
    return `${(sizeBytes / 1_000_000).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(sizeBytes / 1_000))} KB`;
}

function formatAiMarkdown(rawText) {
  if (!rawText) {
    return '';
  }

  return String(rawText)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    // Fix malformed section labels from model output: "Heading:* content"
    .replace(/(^|\n)([A-Z][^:\n]{2,80}):\*\s*/g, '$1### $2\n\n')
    // Ensure section labels become readable heading blocks.
    .replace(/([.!?])\s+([A-Z][A-Za-z0-9 ,/&()'-]{2,80}:)(?=\s)/g, '$1\n\n$2')
    .replace(/(^|\n)([A-Z][A-Za-z0-9 ,/&()'-]{2,80}):\s*/g, '$1### $2\n\n')
    // Convert noisy star separators into bullets.
    .replace(/\s\*\s(?=[A-Z0-9])/g, '\n- ')
    // Remove repeated standalone stars from OCR/noisy chunks.
    .replace(/(^|\s)\*{2,}(?=\s|$)/g, '$1')
    // Keep list markers on their own line.
    .replace(/([^\n])\s+(?=(?:[-*+] |\d+\. ))/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function UserMessage({ text, time = '02:02 PM', attachment = null, userInitial = '?' }) {
  return (
    <div className="message-row user-row animate-slide-right">
      <div className="user-message-wrapper">
        <div className="user-bubble">
          {attachment ? (
            <div className="user-attachment-chip">
              <FileText size={14} />
              <div className="user-attachment-meta">
                <span className="user-attachment-name">{attachment.name}</span>
                <span className="user-attachment-size mono">{formatAttachmentSize(attachment.sizeBytes)}</span>
              </div>
            </div>
          ) : null}
          {text ? <p>{text}</p> : null}
        </div>
        <p className="message-timestamp mono">
          {time}
          {' '}
          {'\u00b7 SENT'}
        </p>
      </div>
      <div className="user-avatar" aria-hidden="true">
        <span>{userInitial}</span>
      </div>
    </div>
  );
}

export function AIMessage({ text, citations = [], latency }) {
  return (
    <div className="message-row ai-row animate-slide-left">
      <div className="ai-avatar">
        <Bot size={18} />
      </div>
      <div className="ai-message-wrapper">
        <div className="ai-bubble">
          <div className="ai-content">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {formatAiMarkdown(text)}
            </ReactMarkdown>
          </div>

          {citations.length > 0 && (
            <div className="citations-section">
              <span className="citations-label mono">Citations found:</span>
              <div className="citations-list">
                {citations.map((cite, index) => (
                  <button key={index} className="citation-chip" id={`citation-${index}`} type="button">
                    <FileText size={12} className="citation-icon" />
                    <span>Page {cite.page_number || cite.page || '?'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="message-actions">
          {latency ? <span className="latency-label mono">GENERATED IN {latency}</span> : null}
          <div className="action-buttons">
            <button className="btn-icon" type="button" aria-label="Thumbs up" title="Helpful">
              <ThumbsUp size={14} />
            </button>
            <button className="btn-icon" type="button" aria-label="Thumbs down" title="Not helpful">
              <ThumbsDown size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
