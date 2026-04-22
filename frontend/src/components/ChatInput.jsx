/**
 * ChatInput - Message composer with delayed file attachment send flow.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FileText, Paperclip, Plus, Send, X, Zap } from 'lucide-react';
import './ChatInput.css';

const ChatInput = forwardRef(function ChatInput({
  value,
  onValueChange,
  onSend,
  onSendWithFile,
  disabled = false,
  activeDoc,
  isUploading = false,
  suggestions = [],
  statusText = '',
  summaryMode = 'normal',
  onSummaryModeChange,
}, ref) {
  const [attachedFile, setAttachedFile] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSheetClosing, setIsSheetClosing] = useState(false);
  const sheetCloseTimer = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const closeSheet = () => {
    setIsSheetClosing(true);
    sheetCloseTimer.current = window.setTimeout(() => {
      setIsMobileMenuOpen(false);
      setIsSheetClosing(false);
    }, 240);
  };

  // Cleanup timer on unmount
  const clearSheetTimer = () => {
    if (sheetCloseTimer.current) {
      window.clearTimeout(sheetCloseTimer.current);
    }
  };

  const resizeTextarea = (element) => {
    if (!element) {
      return;
    }

    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  };

  const clearAttachment = () => {
    setAttachedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useImperativeHandle(ref, () => ({
    openFilePicker: () => {
      if (!isUploading) {
        fileInputRef.current?.click();
      }
    },
    clearAttachment,
    getAttachedFile: () => attachedFile,
  }), [attachedFile, isUploading]);

  // Cleanup close-animation timer on unmount
  useEffect(() => clearSheetTimer, []);

  const placeholder = useMemo(() => {
    if (attachedFile) {
      return 'Add an optional prompt to send with this PDF...';
    }

    if (activeDoc) {
      const truncated = activeDoc.length > 24 ? `${activeDoc.slice(0, 22)}\u2026` : activeDoc;
      return `Ask a question about ${truncated}`;
    }

    return 'Ask a question or attach a PDF...';
  }, [activeDoc, attachedFile]);

  const clearComposer = () => {
    onValueChange?.('');
    clearAttachment();

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const canSend = Boolean(value.trim()) && !disabled && !isUploading;

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!canSend) {
      return;
    }

    const didStart = attachedFile
      ? await onSendWithFile?.(trimmed, attachedFile, false)
      : await onSend?.(trimmed, false);

    if (didStart === false) {
      return;
    }

    clearComposer();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const handleInput = (event) => {
    onValueChange?.(event.target.value);
    resizeTextarea(event.target);
  };

  const handleSuggestionClick = (suggestion) => {
    onValueChange?.(suggestion);
    textareaRef.current?.focus();
    resizeTextarea(textareaRef.current);
  };

  const handleUploadClick = () => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  };

  const handleFileInput = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      setAttachedFile(file);
    }

    event.target.value = '';
  };

  return (
    <div className="chat-input-wrapper">
      <div className="chat-input-container">
        <div className="chat-input-glow" />

        <div className="chat-input-inner">
          {statusText ? (
            <div className="chat-input-status">
              <span className="mono-label">{statusText}</span>
            </div>
          ) : null}

          {attachedFile ? (
            <div className="attachment-chip-row">
              <div className="attachment-chip">
                <FileText size={14} />
                <span className="attachment-chip-name">{attachedFile.name}</span>
                <button
                  type="button"
                  className="attachment-chip-remove"
                  aria-label="Remove attachment"
                  onClick={clearAttachment}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder={placeholder}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={disabled || isUploading}
            rows={1}
            id="chat-input"
          />

          <div className="chat-input-actions">
            <div className="chat-input-left">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                hidden
                onChange={handleFileInput}
              />

              <button
                className="btn-icon"
                type="button"
                aria-label="Attach PDF"
                id="attach-file"
                onClick={handleUploadClick}
                disabled={isUploading}
                title="Attach a PDF"
              >
                <Paperclip size={18} />
              </button>

              {/* Mobile-only + button — opens the bottom sheet */}
              <button
                className={`mobile-plus-btn${isMobileMenuOpen ? ' active' : ''}`}
                type="button"
                aria-label="More options"
                onClick={() => isMobileMenuOpen ? closeSheet() : setIsMobileMenuOpen(true)}
              >
                <Plus size={18} />
              </button>

              <div className="input-divider" />

              <div className="summary-mode-control">
                <select
                  className="summary-mode-select"
                  value={summaryMode}
                  onChange={(e) => onSummaryModeChange?.(e.target.value)}
                  disabled={isUploading}
                  aria-label="Summary Mode"
                  title="Choose summary mode"
                >
                  <option value="normal">Normal</option>
                  <option value="quick">Quick</option>
                  <option value="standard">Standard</option>
                  <option value="deep">Deep</option>
                  <option value="executive">Executive</option>
                  <option value="student">Student Notes</option>
                </select>
              </div>

              {suggestions.length > 0 ? (
                <div className="chat-input-hints">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      className="hint-chip"
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      disabled={disabled || isUploading}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              className="send-button"
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!canSend}
              id="send-button"
              aria-label="Send message"
            >
              {isUploading ? <span className="send-spinner" aria-hidden="true" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {suggestions.length > 0 ? (
        <div className="quick-actions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              className="quick-action-btn"
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              disabled={disabled || isUploading}
            >
              <Zap size={14} />
              <span>{suggestion}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Mobile bottom-sheet: modes + suggestions */}
      {isMobileMenuOpen && (
        <div className={`mobile-sheet-overlay${isSheetClosing ? ' closing' : ''}`} onClick={closeSheet}>
          <div className={`mobile-sheet${isSheetClosing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-handle" />

            <div className="mobile-sheet-section">
              <p className="mobile-sheet-label">Mode</p>
              <div className="mobile-sheet-modes">
                {[
                  { value: 'normal', label: 'Normal' },
                  { value: 'quick', label: 'Quick' },
                  { value: 'standard', label: 'Standard' },
                  { value: 'deep', label: 'Deep' },
                  { value: 'executive', label: 'Executive' },
                  { value: 'student', label: 'Student Notes' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    className={`mobile-mode-btn${summaryMode === value ? ' active' : ''}`}
                    type="button"
                    disabled={disabled || isUploading}
                    onClick={() => { onSummaryModeChange?.(value); closeSheet(); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="mobile-sheet-section">
                <p className="mobile-sheet-label">Suggestions</p>
                <div className="mobile-sheet-hints">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      className="mobile-hint-btn"
                      type="button"
                      onClick={() => { handleSuggestionClick(suggestion); closeSheet(); }}
                      disabled={disabled || isUploading}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatInput;
