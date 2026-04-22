import { BarChart3, Brain, Sparkles, Mail, Phone, Globe, ExternalLink } from 'lucide-react';
import SmartText from './SmartText';
import './SmartText.css';
import './DocumentSummaryPanel.css';

const SUMMARY_MODES = [
  { value: 'normal', label: 'Normal' },
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard' },
  { value: 'deep', label: 'Deep' },
  { value: 'executive', label: 'Executive' },
  { value: 'student', label: 'Student Notes' },
];

function formatConfidence(value) {
  const numeric = Number(value) || 0;
  return `${Math.round(numeric * 100)}%`;
}

function normalizeModeLabel(value = '') {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

const DOC_TYPE_COLORS = {
  'Resume': 'chip-green',
  'Research paper': 'chip-blue',
  'Legal agreement': 'chip-amber',
  'Medical report': 'chip-red',
  'Business proposal': 'chip-purple',
  'Financial report': 'chip-cyan',
  'Class notes': 'chip-teal',
};

// ── Contact extraction for Resumes ──
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s\-().]{7,}\d/g;
const URL_RE = /https?:\/\/[^\s,)<>]+/gi;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[^\s,)<>]+/gi;
const GITHUB_RE = /(?:https?:\/\/)?github\.com\/[^\s,)<>]+/gi;

function dedupePhones(phones) {
  const seen = new Set();
  return phones.filter((p) => {
    const key = p.replace(/[\s\-().+]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractContacts(summary) {
  if (!summary) return null;

  // Prefer backend-provided contact_info (pre-extracted, deduplicated raw contacts)
  const textPool = summary.contact_info?.length
    ? summary.contact_info.join('\n')
    : [
        summary.overview,
        summary.why_it_matters,
        summary.final_takeaway,
        ...(summary.executive_summary || []),
        ...(summary.main_insights || []).map((i) => i.detail),
      ].filter(Boolean).join(' ');

  const emails = [...new Set(textPool.match(EMAIL_RE) || [])];
  const phones = dedupePhones(textPool.match(PHONE_RE) || []);
  const linkedins = [...new Set(textPool.match(LINKEDIN_RE) || [])];
  const githubs = [...new Set(textPool.match(GITHUB_RE) || [])];
  const urls = [...new Set((textPool.match(URL_RE) || []).filter(
    (u) => !linkedins.some((l) => u.includes(l)) && !githubs.some((g) => u.includes(g)),
  ))];

  const hasAny = emails.length || phones.length || linkedins.length || githubs.length || urls.length;
  return hasAny ? { emails, phones, linkedins, githubs, urls } : null;
}

function ContactBar({ contacts }) {
  if (!contacts) return null;
  return (
    <div className="summary-contact-bar">
      {contacts.emails.map((e) => (
        <a key={e} href={`mailto:${e}`} className="contact-chip contact-email">
          <Mail size={13} /> {e}
        </a>
      ))}
      {contacts.phones.map((p) => (
        <a key={p} href={`tel:${p.replace(/[\s()-]/g, '')}`} className="contact-chip contact-phone">
          <Phone size={13} /> {p}
        </a>
      ))}
      {contacts.linkedins.map((l) => (
        <a key={l} href={l.startsWith('http') ? l : `https://${l}`} target="_blank" rel="noopener noreferrer" className="contact-chip contact-linkedin">
          <ExternalLink size={13} /> LinkedIn
        </a>
      ))}
      {contacts.githubs.map((g) => (
        <a key={g} href={g.startsWith('http') ? g : `https://${g}`} target="_blank" rel="noopener noreferrer" className="contact-chip contact-github">
          <ExternalLink size={13} /> GitHub
        </a>
      ))}
      {contacts.urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="contact-chip contact-url">
          <Globe size={13} /> {u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '')}
        </a>
      ))}
    </div>
  );
}

export default function DocumentSummaryPanel({
  documentName,
  documentStatus,
  mode = 'normal',
  summary,
  isLoading = false,
  error = '',
}) {
  const isResume = summary?.document_type === 'Resume';
  const contacts = isResume ? extractContacts(summary) : null;
  const docTypeChipClass = DOC_TYPE_COLORS[summary?.document_type] || 'chip-secondary';

  return (
    <section className="summary-panel">
      <div className="summary-panel-header">
        <div>
          <span className="mono-label summary-kicker">Document intelligence</span>
          <h2 className="summary-title">Human-level summary</h2>
          <p className="summary-subtitle">
            {isLoading
              ? 'Understanding document structure, ranking important sections, and drafting a grounded summary...'
              : `Structured summary for ${documentName || 'the selected document'}`}
          </p>
        </div>
      </div>

      {documentStatus !== 'indexed' ? (
        <div className="summary-status-card">
          <Brain size={18} />
          <div>
            <p className="summary-status-title">Understanding document...</p>
            <p className="summary-status-copy">
              The summary will unlock once indexing finishes so the analysis can use the full document safely.
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="summary-status-card error">
          <Sparkles size={18} />
          <div>
            <p className="summary-status-title">Summary unavailable</p>
            <p className="summary-status-copy">{error}</p>
          </div>
        </div>
      ) : isLoading || !summary ? (
        <div className="summary-loading-grid">
          <div className="summary-skeleton large" />
          <div className="summary-skeleton medium" />
          <div className="summary-skeleton medium" />
          <div className="summary-skeleton wide" />
        </div>
      ) : (
        <div className="summary-body">
          <div className="summary-meta-row">
            <span className={`chip ${docTypeChipClass}`}>{summary.document_type}</span>
            <span className="chip chip-primary">{formatConfidence(summary.confidence)} confidence</span>
            <span className="chip chip-warning">{normalizeModeLabel(summary.mode)}</span>
            {summary.page_count ? (
              <span className="chip chip-muted">{summary.page_count} {summary.page_count === 1 ? 'page' : 'pages'}</span>
            ) : null}
          </div>

          <div className="summary-doc-title">{summary.title || documentName}</div>

          {contacts ? <ContactBar contacts={contacts} /> : null}

          <div className="summary-section-card overview executive">
            <div className="summary-section-heading">
              <Sparkles size={16} />
              <h3>Executive Summary</h3>
            </div>
            {(summary.executive_summary?.length ? summary.executive_summary : [summary.overview, summary.why_it_matters])
              .filter(Boolean)
              .slice(0, 4)
              .map((paragraph, index) => (
                <p key={`summary-paragraph-${index}`}><SmartText text={paragraph} /></p>
              ))}
          </div>

          {summary.landmark_note ? (
            <div className="summary-callout">
              <p><SmartText text={summary.landmark_note} /></p>
            </div>
          ) : null}

          {summary.main_insights?.length ? (
            <div className="summary-section-card">
              <div className="summary-section-heading">
                <Brain size={16} />
                <h3>Key Insights</h3>
              </div>
              <div className="summary-insights-grid">
                {summary.main_insights.map((insight) => (
                  <article key={`${insight.title}-${insight.detail}`} className="summary-insight-card">
                    <div className="summary-insight-top">
                      <h4>{insight.title}</h4>
                    </div>
                    <p><SmartText text={insight.detail} /></p>
                    {insight.supporting_pages?.length ? (
                      <div className="summary-pages-row">
                        {insight.supporting_pages.map((page) => (
                          <span key={`${insight.title}-page-${page}`} className="summary-page-chip">
                            p. {page}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {summary.key_metrics?.length ? (
            <div className="summary-section-card">
              <div className="summary-section-heading">
                <BarChart3 size={16} />
                <h3>Important Metrics</h3>
              </div>
              <div className="summary-metric-grid">
                {summary.key_metrics.map((metric) => (
                  <article key={`${metric.label}-${metric.value}`} className="summary-metric-card">
                    <p className="summary-metric-label">{metric.label}</p>
                    <p className="summary-metric-value"><SmartText text={String(metric.value)} /></p>
                    {metric.context ? <p className="summary-metric-context"><SmartText text={metric.context} /></p> : null}
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {summary.final_takeaway ? (
            <div className="summary-section-card takeaway">
              <div className="summary-section-heading">
                <Sparkles size={16} />
                <h3>Final Verdict</h3>
              </div>
              <p><SmartText text={summary.final_takeaway} /></p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
