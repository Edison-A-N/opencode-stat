import "./styles.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

// --- Types ---
interface Totals {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  messages: number;
  sessions: number;
  task_calls: number;
  no_load_skills: number;
}
interface DailyRow {
  date: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  sessions: number;
  messages: number;
}
interface AgentRow {
  name: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  messages: number;
}
interface AgentModelRow extends AgentRow {
  agent: string;
  model: string;
}
interface CountRow {
  name: string;
  count: number;
}
interface SessionRow {
  session_id: string;
  title: string;
  agent: string;
  model: string;
  total_tokens: number;
  messages: number;
  recovered: boolean;
}
interface Summary {
  status: string;
  totals: Totals;
  daily: DailyRow[];
  top_agents: AgentRow[];
  top_agent_models: AgentModelRow[];
  delegations: CountRow[];
  task_skills: CountRow[];
  direct_skills: CountRow[];
  top_sessions: SessionRow[];
  recovery: { empty_sessions: number; recovered_sessions: number; recovered_percent: number };
}
interface Health {
  status: string;
  db_path: string;
  db_exists: boolean;
  now: string;
  now_ms: number;
}

// --- Utils ---
function fmt(n: number | undefined): string {
  if (!n && n !== 0) return "—";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}
function fmtFull(n: number | undefined): string {
  if (!n && n !== 0) return "";
  return n.toLocaleString("en-US");
}
function fmtDate(s: string): string {
  const [, month, day] = s.split("-");
  return month && day ? `${month}/${day}` : s;
}
function deltaPct(curr: number, prev: number): string {
  if (!prev || prev === 0) return "—";
  const pct = ((curr - prev) / prev) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
function deltaClass(curr: number, prev: number): string {
  if (!prev || prev === 0) return "neutral";
  return curr > prev ? "up" : curr < prev ? "down" : "neutral";
}

// --- Hooks ---
function useSummary(days: number) {
  return useQuery({
    queryKey: ["summary", days],
    queryFn: async () => {
      const res = await fetch(`/api/summary?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Summary;
    },
    refetchInterval: 15_000,
  });
}
function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      return (await res.json()) as Health;
    },
    refetchInterval: 10_000,
  });
}

// --- Components ---
function KpiCard({ label, value, full, sub }: { label: string; value: string; full?: string; sub?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" title={full}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function KpiGrid({ totals }: { totals: Totals }) {
  return (
    <section className="kpi-grid">
      <KpiCard label="Total Tokens" value={fmt(totals.total_tokens)} full={fmtFull(totals.total_tokens)} />
      <KpiCard label="Input" value={fmt(totals.input_tokens)} full={fmtFull(totals.input_tokens)} />
      <KpiCard label="Output" value={fmt(totals.output_tokens)} full={fmtFull(totals.output_tokens)} />
      <KpiCard label="Cache Read" value={fmt(totals.cache_read_tokens)} full={fmtFull(totals.cache_read_tokens)} />
      <KpiCard label="Messages" value={fmt(totals.messages)} full={fmtFull(totals.messages)} />
      <KpiCard label="Sessions" value={fmt(totals.sessions)} full={fmtFull(totals.sessions)} />
    </section>
  );
}

function DailySection({ daily }: { daily: DailyRow[] }) {
  const sorted = [...daily].sort((a, b) => b.date.localeCompare(a.date));
  const maxTokens = Math.max(...sorted.map((d) => d.total_tokens || 0), 1);
  return (
    <section className="panel">
      <h2 className="panel-title">Daily Token Usage</h2>
      <div className="chart-container">
        {sorted.slice(0, 7).reverse().map((d) => {
          const pct = (d.total_tokens / maxTokens) * 100;
          return (
            <div key={d.date} className="bar-row">
              <div className="bar-label">{fmtDate(d.date)}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="bar-value">{fmt(d.total_tokens)}</div>
            </div>
          );
        })}
      </div>
      <table className="data-table">
        <thead><tr><th>Date</th><th className="num">Total</th><th className="num">Input</th><th className="num">Output</th><th className="num">Δ Day</th></tr></thead>
        <tbody>
          {sorted.map((d, i) => {
            const prev = sorted[i + 1];
            return (
              <tr key={d.date}>
                <td>{fmtDate(d.date)}</td>
                <td className="num" title={fmtFull(d.total_tokens)}>{fmt(d.total_tokens)}</td>
                <td className="num" title={fmtFull(d.input_tokens)}>{fmt(d.input_tokens)}</td>
                <td className="num" title={fmtFull(d.output_tokens)}>{fmt(d.output_tokens)}</td>
                <td className={`num delta-${prev ? deltaClass(d.total_tokens, prev.total_tokens) : "neutral"}`}>
                  {prev ? deltaPct(d.total_tokens, prev.total_tokens) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function AgentsSection({ agents }: { agents: AgentRow[] }) {
  const maxTokens = agents[0]?.total_tokens || 0;
  const totalSum = agents.reduce((s, a) => s + (a.total_tokens || 0), 0);
  return (
    <section className="panel">
      <h2 className="panel-title">Top Agents</h2>
      <div className="chart-container">
        {agents.slice(0, 8).map((a) => {
          const pct = maxTokens > 0 ? (a.total_tokens / maxTokens) * 100 : 0;
          return (
            <div key={a.name} className="bar-row">
              <div className="bar-label" title={a.name}>{a.name.length > 28 ? `${a.name.slice(0, 26)}..` : a.name}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="bar-value">{fmt(a.total_tokens)}</div>
            </div>
          );
        })}
      </div>
      <table className="data-table">
        <thead><tr><th>Agent</th><th className="num">Tokens</th><th className="num">Share</th><th className="num">Messages</th></tr></thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.name}>
              <td>{a.name}</td>
              <td className="num" title={fmtFull(a.total_tokens)}>{fmt(a.total_tokens)}</td>
              <td className="num">{totalSum > 0 ? ((a.total_tokens / totalSum) * 100).toFixed(1) : "0"}%</td>
              <td className="num">{fmt(a.messages)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AgentModelTable({ rows }: { rows: AgentModelRow[] }) {
  return (
    <section className="panel full-width">
      <h2 className="panel-title">Agent × Model Breakdown</h2>
      <table className="data-table">
        <thead><tr><th>Agent</th><th>Model</th><th className="num">Total</th><th className="num">Input</th><th className="num">Cache Read</th><th className="num">Messages</th></tr></thead>
        <tbody>
          {rows.slice(0, 30).map((r) => (
            <tr key={`${r.agent}|${r.model}`}>
              <td>{r.agent}</td>
              <td>{r.model}</td>
              <td className="num" title={fmtFull(r.total_tokens)}>{fmt(r.total_tokens)}</td>
              <td className="num" title={fmtFull(r.input_tokens)}>{fmt(r.input_tokens)}</td>
              <td className="num" title={fmtFull(r.cache_read_tokens)}>{fmt(r.cache_read_tokens)}</td>
              <td className="num">{fmt(r.messages)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CountPanel({ title, items }: { title: string; items: CountRow[] }) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      <div className="mini-list">
        {items.length === 0 ? <span className="empty-state">No data</span> : items.map((item) => (
          <div key={item.name} className="mini-row">
            <span className="mini-label">{item.name}</span>
            <span className="mini-value">{fmt(item.count)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopSessionsTable({ sessions }: { sessions: SessionRow[] }) {
  return (
    <section className="panel full-width">
      <h2 className="panel-title">Top Sessions</h2>
      <table className="data-table">
        <thead><tr><th>Session</th><th>Agent</th><th>Model</th><th className="num">Tokens</th><th className="num">Messages</th></tr></thead>
        <tbody>
          {sessions.slice(0, 20).map((s) => (
            <tr key={s.session_id}>
              <td className="mono" title={s.title || s.session_id}>{s.title || s.session_id.slice(0, 20)}</td>
              <td>{s.agent || "—"}</td>
              <td>{s.model || "—"}</td>
              <td className="num" title={fmtFull(s.total_tokens)}>{fmt(s.total_tokens)}</td>
              <td className="num">{fmt(s.messages)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RecoveryPanel({ recovery }: { recovery: Summary["recovery"] }) {
  return (
    <section className="panel full-width">
      <h2 className="panel-title">Empty Session Recovery</h2>
      <p className="recovery-explain">
        Sessions with empty <code>agent</code>/<code>model</code> fields in the DB are recovered from <code>message.data</code>.
        Recovered: <strong>{recovery.recovered_sessions}</strong> / {recovery.empty_sessions} ({recovery.recovered_percent}%)
      </p>
    </section>
  );
}

// --- App ---
function App() {
  const [days, setDays] = useState(7);
  const health = useHealth();
  const summary = useSummary(days);

  const isLoading = summary.isLoading && !summary.data;
  const isError = summary.isError;
  const data = summary.data;

  const healthOk = health.data?.status === "ok";

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1 className="header-title"><span className="header-icon">▸</span> OpenCode Stats</h1>
          <div className={`health-badge ${healthOk ? "healthy" : "unhealthy"}`}>
            <span className="health-dot" />
            <span className="health-text">{healthOk ? "ONLINE" : "OFFLINE"}</span>
          </div>
        </div>
        <div className="header-right">
          <span className="refresh-info">Auto-refresh: 15s</span>
          <span className="last-updated">
            {summary.dataUpdatedAt ? `Last: ${new Date(summary.dataUpdatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "—"}
          </span>
          <select className="days-selector" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button type="button" className="btn-refresh" onClick={() => summary.refetch()}>
            <span className="btn-icon">↻</span> Refresh
          </button>
        </div>
      </header>

      {isError && (
        <div className="error-banner">
          <span className="error-icon">⚠</span>
          <span>Failed to load: {(summary.error as Error)?.message}</span>
        </div>
      )}

      {isLoading && <div className="loading-overlay"><div className="loading-spinner" /><p>Loading...</p></div>}

      {data && (
        <>
          <KpiGrid totals={data.totals} />
          <div className="grid-two-col">
            <DailySection daily={data.daily} />
            <AgentsSection agents={data.top_agents} />
          </div>
          <AgentModelTable rows={data.top_agent_models} />
          <div className="grid-three-col">
            <CountPanel title="Delegations" items={data.delegations} />
            <CountPanel title="Task Load Skills" items={data.task_skills} />
            <CountPanel title="Direct Skill Calls" items={data.direct_skills} />
          </div>
          <TopSessionsTable sessions={data.top_sessions} />
          <RecoveryPanel recovery={data.recovery} />
          <footer className="footer">
            <span>OpenCode Token Dashboard</span>
            <span className="footer-sep">·</span>
            <span>Data: local SQLite (read-only)</span>
          </footer>
        </>
      )}
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}
const root = createRoot(rootElement);
root.render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
