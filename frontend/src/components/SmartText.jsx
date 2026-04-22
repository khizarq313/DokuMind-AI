import React from 'react';

const SMART_PATTERN = /(\bhttps?:\/\/[^\s,)<>]+|(?:linkedin\.com\/in\/|github\.com\/)[^\s,)<>]+|\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b|\+?\d[\d\s\-().]{7,}\d)/gi;

function classifyMatch(match) {
  if (/^https?:\/\//i.test(match)) {
    if (/linkedin\.com/i.test(match)) return 'linkedin';
    if (/github\.com/i.test(match)) return 'github';
    return 'url';
  }
  if (/linkedin\.com\/in\//i.test(match)) return 'linkedin';
  if (/github\.com\//i.test(match)) return 'github';
  if (/@/.test(match)) return 'email';
  if (/^\+?\d/.test(match)) return 'phone';
  return 'url';
}

function buildHref(match, kind) {
  switch (kind) {
    case 'email':
      return `mailto:${match}`;
    case 'phone':
      return `tel:${match.replace(/[\s()-]/g, '')}`;
    case 'linkedin':
      return match.startsWith('http') ? match : `https://${match}`;
    case 'github':
      return match.startsWith('http') ? match : `https://${match}`;
    default:
      return match;
  }
}

function buildLabel(match, kind) {
  switch (kind) {
    case 'linkedin':
      return match.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
    case 'github':
      return match.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
    case 'url':
      return match.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
    default:
      return match;
  }
}

export default function SmartText({ text, className }) {
  if (!text) return null;

  const parts = [];
  let lastIndex = 0;
  let match;

  const regex = new RegExp(SMART_PATTERN.source, 'gi');
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    const kind = classifyMatch(raw);
    parts.push(
      <a
        key={match.index}
        href={buildHref(raw, kind)}
        target={kind === 'email' || kind === 'phone' ? undefined : '_blank'}
        rel={kind === 'email' || kind === 'phone' ? undefined : 'noopener noreferrer'}
        className={`smart-link smart-link-${kind}`}
      >
        {buildLabel(raw, kind)}
      </a>,
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts}</span>;
}
