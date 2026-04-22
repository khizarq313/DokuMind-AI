import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  ExternalLink,
  FileText,
  Layers,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getAnalytics, getQueryHistory, listDocuments } from '../services/api';
import './AnalyticsPage.css';

const NAV_ITEMS = [
  { icon: BarChart3, label: 'Overview', active: true },
  { icon: FileText, label: 'Documents' },
  { icon: Clock, label: 'History' },
  { icon: Layers, label: 'Models' },
];

function formatLatency(latencyMs) {
  if (!latencyMs) {
    return '0ms';
  }

  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(latencyMs)}ms`;
}

function truncateText(value, limit = 60) {
  if (!value) {
    return 'Untitled query';
  }

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}\u2026`;
}

function formatRelativeTime(value) {
  if (!value) {
    return 'Just now';
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return 'Just now';
  }

  const diffMs = timestamp - Date.now();
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const minutes = Math.round(diffMs / 60000);

  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, 'minute');
  }

  const hours = Math.round(diffMs / 3600000);
  if (Math.abs(hours) < 24) {
    return formatter.format(hours, 'hour');
  }

  const days = Math.round(diffMs / 86400000);
  return formatter.format(days, 'day');
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'DocuMind \u2013 Analytics';
  }, []);

  useEffect(() => {
    let isDisposed = false;

    const loadAnalytics = async (isInitial = false) => {
      if (isInitial) {
        setLoading(true);
      }

      try {
        const [overview, queryHistory, documentsResponse] = await Promise.all([
          getAnalytics(),
          getQueryHistory(),
          listDocuments(),
        ]);

        if (isDisposed) {
          return;
        }

        const recentQueries = Array.isArray(queryHistory)
          ? [...queryHistory].slice(-10).reverse()
          : [];
        const indexedDocumentCount = Array.isArray(documentsResponse?.documents)
          ? documentsResponse.documents.filter((document) => document.status === 'indexed').length
          : 0;

        setAnalytics({
          totalDocuments: indexedDocumentCount,
          totalQueries: Number(overview?.total_queries) || 0,
          avgLatencyMs: Number(overview?.avg_latency_ms) || 0,
          recentQueries,
        });
        setError('');
      } catch {
        if (!isDisposed) {
          setAnalytics(null);
          setError('Start using DocuMind to see your analytics here.');
        }
      } finally {
        if (!isDisposed && isInitial) {
          setLoading(false);
        }
      }
    };

    void loadAnalytics(true);
    const intervalId = window.setInterval(() => {
      void loadAnalytics(false);
    }, 10000);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const recentQueries = useMemo(
    () => analytics?.recentQueries ?? [],
    [analytics?.recentQueries],
  );

  const chartData = useMemo(() => (
    [...recentQueries]
      .reverse()
      .map((query) => ({
        label: new Date(query.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
        latency: Math.round(Number(query.latency_ms) || 0),
      }))
  ), [recentQueries]);

  const kpis = analytics ? [
    {
      label: 'Documents Indexed',
      value: analytics.totalDocuments.toLocaleString(),
      caption: 'Indexed documents from the backend',
      icon: Layers,
      color: 'var(--primary-container)',
    },
    {
      label: 'Total Queries',
      value: analytics.totalQueries.toLocaleString(),
      caption: 'Document-grounded requests served',
      icon: Activity,
      color: 'var(--secondary-container)',
    },
    {
      label: 'Average Latency',
      value: formatLatency(analytics.avgLatencyMs),
      caption: 'Average backend response time',
      icon: Clock,
      color: 'var(--tertiary-container)',
    },
  ] : [];

  return (
    <div className="analytics-page animate-fade-in">
      <nav className="analytics-side-nav">
        {NAV_ITEMS.map(({ icon, label, active }) => {
          const NavIcon = icon;

          return (
            <button
              key={label}
              className={`side-nav-btn ${active ? 'active' : ''}`}
              title={label}
              id={`analytics-nav-${label.toLowerCase()}`}
              type="button"
            >
              <NavIcon size={18} />
            </button>
          );
        })}
        <div className="side-nav-spacer" />
        <button
          className="side-nav-btn mlflow-link"
          title="Open MLflow Dashboard"
          id="mlflow-link"
          type="button"
        >
          <ExternalLink size={18} />
        </button>
      </nav>

      <div className="analytics-content">
        <header className="analytics-header animate-fade-in">
          <div>
            <span className="mono-label analytics-kicker">System Intelligence</span>
            <h1 className="text-headline-lg analytics-title">
              Analytics Overview
            </h1>
          </div>
          <div className="analytics-header-actions">
            {analytics ? (
              <span className="analytics-source-badge">
                Live backend
              </span>
            ) : null}
            <button className="btn-primary" id="download-report" type="button">
              <ExternalLink size={14} />
              Open MLflow
            </button>
          </div>
        </header>

        {loading && !analytics ? (
          <div className="analytics-global-empty animate-fade-in">
            <p className="analytics-empty-title">Loading analytics...</p>
          </div>
        ) : !analytics ? (
          <div className="analytics-global-empty animate-fade-in">
            <p className="analytics-empty-title">No analytics yet</p>
            <p className="analytics-empty-copy">{error}</p>
          </div>
        ) : (
          <>
            <div className="kpi-grid">
              {kpis.map((kpi, index) => {
                const KpiIcon = kpi.icon;

                return (
                  <div
                    key={kpi.label}
                    className="kpi-card animate-fade-in"
                    style={{ animationDelay: `${index * 0.08}s` }}
                  >
                    <div className="kpi-info">
                      <span className="kpi-label mono-label">{kpi.label}</span>
                      <span className="kpi-value">{kpi.value}</span>
                      <span className="kpi-caption">{kpi.caption}</span>
                    </div>
                    <div className="kpi-icon" style={{ background: `${kpi.color}20`, color: kpi.color }}>
                      <KpiIcon size={28} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="chart-section animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="chart-header">
                <div>
                  <h2 className="text-headline-sm chart-title">Recent Query Latency</h2>
                  <p className="text-body-sm chart-copy">
                    Real timings from the latest document-grounded responses
                  </p>
                </div>
              </div>

              <div className="chart-container">
                {chartData.length === 0 ? (
                  <div className="analytics-empty-state">Start using DocuMind to see your analytics here.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradientLive" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="rgba(74, 68, 85, 0.12)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: 'rgba(148,163,184,0.4)', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: 'rgba(148,163,184,0.3)', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#1e1f27',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '8px',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                          fontSize: '0.75rem',
                          fontFamily: 'JetBrains Mono',
                        }}
                        labelStyle={{ color: 'white' }}
                        itemStyle={{ color: 'rgba(203,213,225,0.8)' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="latency"
                        stroke="#d2bbff"
                        strokeWidth={2.5}
                        fill="url(#gradientLive)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="queries-section animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="queries-header">
                <h2 className="text-headline-sm queries-title">Recent Queries</h2>
                <span className="queries-subtitle">Last 10 grounded requests</span>
              </div>

              <div className="queries-table-wrapper">
                <table className="queries-table">
                  <thead>
                    <tr>
                      <th className="mono-label">Query</th>
                      <th className="mono-label">Latency</th>
                      <th className="mono-label">Status</th>
                      <th className="mono-label">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentQueries.length === 0 ? (
                      <tr className="query-row">
                        <td className="query-empty-state" colSpan={4}>
                          Start using DocuMind to see your analytics here.
                        </td>
                      </tr>
                    ) : recentQueries.map((query) => (
                      <tr key={query.query_id || query.timestamp} className="query-row">
                        <td className="query-text">{truncateText(query.query_text, 60)}</td>
                        <td className="mono query-latency">
                          {formatLatency(Number(query.latency_ms) || 0)}
                        </td>
                        <td>
                          <span className={`chip chip-${query.status === 'success' ? 'success' : query.status === 'warning' ? 'warning' : 'error'}`}>
                            {String(query.status).toUpperCase()}
                          </span>
                        </td>
                        <td className="mono query-timestamp">
                          {formatRelativeTime(query.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
