import "./styles.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

// --- Types ---
type Costs = Record<string, number>;
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
  costs: Costs;
}
interface DailyRow {
  date: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  sessions: number;
  messages: number;
  costs: Costs;
}
interface AgentRow {
  name: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  messages: number;
  costs: Costs;
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
  costs: Costs;
}
type Granularity = "day" | "hour";
interface HourlyRow {
  date: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  sessions: number;
  messages: number;
  costs: Costs;
}
interface Summary {
  status: string;
  granularity: Granularity;
  totals: Totals;
  daily: DailyRow[];
  hourly: HourlyRow[];
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

function fmtHour(s: string): string {
  const tIdx = s.indexOf("T");
  if (tIdx < 0) return s;
  return s.slice(tIdx + 1);
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", CNY: "¥" };
function fmtCost(costs: Costs | undefined): string {
  if (!costs) return "—";
  const entries = Object.entries(costs).filter(([, v]) => v > 0);
  if (entries.length === 0) return "—";
  return entries.map(([cur, val]) => `${CURRENCY_SYMBOLS[cur] || cur}${val.toFixed(2)}`).join(" · ");
}
function fmtCostFull(costs: Costs | undefined): string {
  if (!costs) return "";
  const entries = Object.entries(costs).filter(([, v]) => v > 0);
  if (entries.length === 0) return "";
  return entries.map(([cur, val]) => `${CURRENCY_SYMBOLS[cur] || cur}${val.toFixed(4)}`).join(" · ");
}
function fmtCostMultiLine(costs: Costs | undefined): { currency: string; symbol: string; value: string }[] {
  if (!costs) return [];
  return Object.entries(costs)
    .filter(([, v]) => v > 0)
    .map(([cur, val]) => ({ currency: cur, symbol: CURRENCY_SYMBOLS[cur] || cur, value: val.toFixed(2) }));
}

// --- Hooks ---
function useSummary(days: number, granularity: Granularity, refreshMs: number | false) {
  return useQuery({
    queryKey: ["summary", days, granularity],
    queryFn: async () => {
      const res = await fetch(`/api/summary?days=${days}&granularity=${granularity}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Summary;
    },
    refetchInterval: refreshMs,
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
function KpiCard({ label, value, full, sub, children }: { label: string; value: string; full?: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" title={full}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {children}
    </div>
  );
}

function KpiGrid({ totals }: { totals: Totals }) {
  const costLines = fmtCostMultiLine(totals.costs);
  return (
    <section className="kpi-grid">
      <KpiCard label="Total Tokens" value={fmt(totals.total_tokens)} full={fmtFull(totals.total_tokens)} />
      <KpiCard label="Input" value={fmt(totals.input_tokens)} full={fmtFull(totals.input_tokens)} />
      <KpiCard label="Output" value={fmt(totals.output_tokens)} full={fmtFull(totals.output_tokens)} />
      <KpiCard label="Cache Read" value={fmt(totals.cache_read_tokens)} full={fmtFull(totals.cache_read_tokens)} />
      <KpiCard label="Cost" value={costLines.length === 1 ? `${costLines[0].symbol}${costLines[0].value}` : "—"} full={fmtCostFull(totals.costs)}>
        {costLines.length > 1 && (
          <div className="kpi-cost-list">
            {costLines.map((c) => (
              <div key={c.currency} className="kpi-cost-line">{c.symbol}{c.value} <span className="kpi-cost-cur">{c.currency}</span></div>
            ))}
          </div>
        )}
      </KpiCard>
      <KpiCard label="Sessions" value={fmt(totals.sessions)} full={fmtFull(totals.sessions)} />
    </section>
  );
}

function LineChart({ points, color = "var(--accent-cyan)" }: { points: { label: string; value: number }[]; color?: string }) {
  if (points.length === 0) return <div className="chart-empty">No data</div>;
  const W = 800, H = 200, PAD_L = 50, PAD_R = 10, PAD_T = 10, PAD_B = 30;
  const cw = W - PAD_L - PAD_R, ch = H - PAD_T - PAD_B;
  const maxV = Math.max(...points.map(p => p.value), 1);
  const xStep = points.length > 1 ? cw / (points.length - 1) : 0;
  const xOf = (i: number) => PAD_L + i * xStep;
  const yOf = (v: number) => PAD_T + ch - (v / maxV) * ch;
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(p.value)}`).join(" ");
  const areaD = pathD + ` L${xOf(points.length - 1)},${PAD_T + ch} L${PAD_L},${PAD_T + ch} Z`;
  const yTicks = 4;
  const xLabelInterval = Math.max(1, Math.ceil(points.length / (W > 600 ? 12 : 6)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (maxV / yTicks) * i;
        const y = yOf(v);
        return <g key={`y${i}`}>
          <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--border-default)" strokeDasharray="3,3" />
          <text x={PAD_L - 4} y={y + 4} className="chart-axis-label" textAnchor="end">{fmt(v)}</text>
        </g>;
      })}
      {points.map((p, i) => i % xLabelInterval === 0 ? (
        <text key={`x${i}`} x={xOf(i)} y={H - 4} className="chart-axis-label" textAnchor="middle">{p.label}</text>
      ) : null)}
      <path d={areaD} fill={color} opacity={0.1} />
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} />
      {points.map((p, i) => <circle key={i} cx={xOf(i)} cy={yOf(p.value)} r={3} fill={color}>
        <title>{`${p.label}: ${fmtFull(p.value)}`}</title>
      </circle>)}
    </svg>
  );
}

function StackedBarChart({ rows }: { rows: { label: string; input: number; output: number; cache: number }[] }) {
  if (rows.length === 0) return <div className="chart-empty">No data</div>;
  const W = 800, H = 180, PAD_L = 50, PAD_R = 10, PAD_T = 10, PAD_B = 30;
  const cw = W - PAD_L - PAD_R, ch = H - PAD_T - PAD_B;
  const maxV = Math.max(...rows.map(r => r.input + r.output + r.cache), 1);
  const barW = Math.max(1, cw / rows.length - 1);
  const yOf = (v: number) => PAD_T + ch - (v / maxV) * ch;
  const yTicks = 3;
  const xLabelInterval = Math.max(1, Math.ceil(rows.length / (W > 600 ? 12 : 6)));
  const layers = [
    { key: "output" as const, color: "var(--accent-red)" },
    { key: "input" as const, color: "var(--accent-cyan)" },
    { key: "cache" as const, color: "var(--accent-emerald)" },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (maxV / yTicks) * i;
        const y = yOf(v);
        return <g key={`y${i}`}>
          <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--border-default)" strokeDasharray="3,3" />
          <text x={PAD_L - 4} y={y + 4} className="chart-axis-label" textAnchor="end">{fmt(v)}</text>
        </g>;
      })}
      {rows.map((r, i) => {
        const x = PAD_L + i * (cw / rows.length);
        let yBottom = PAD_T + ch;
        const bars = layers.map(l => {
          const v = r[l.key];
          const yTop = yOf(r.input + r.output + r.cache - (l.key === "output" ? r.output + r.input + r.cache : l.key === "input" ? r.input + r.cache : r.cache) + v);
          const h = yBottom - yTop;
          yBottom = yTop;
          return h > 0 ? <rect key={l.key} x={x} y={yTop} width={barW} height={h} fill={l.color} opacity={0.8}>
            <title>{`${r.label} ${l.key}: ${fmtFull(v)}`}</title>
          </rect> : null;
        });
        return <g key={i}>
          {bars}
          {i % xLabelInterval === 0 ? <text x={x + barW / 2} y={H - 4} className="chart-axis-label" textAnchor="middle">{r.label}</text> : null}
        </g>;
      })}
    </svg>
  );
}

function TrendSection({ daily, hourly, granularity }: { daily: DailyRow[]; hourly: HourlyRow[]; granularity: Granularity }) {
  const useHourly = granularity === "hour";
  const trendPoints = useHourly
    ? hourly.map(h => ({ label: fmtHour(h.date), value: h.total_tokens }))
    : daily.map(d => ({ label: fmtDate(d.date), value: d.total_tokens }));
  const stackRows = useHourly
    ? hourly.map(h => ({ label: fmtHour(h.date), input: h.input_tokens, output: h.output_tokens, cache: h.cache_read_tokens }))
    : daily.map(d => ({ label: fmtDate(d.date), input: d.input_tokens, output: d.output_tokens, cache: d.cache_read_tokens }));
  const sorted = useHourly
    ? [...hourly].sort((a, b) => b.date.localeCompare(a.date))
    : [...daily].sort((a, b) => b.date.localeCompare(a.date));
  const dateCol = useHourly ? "Time" : "Date";
  const labelFn = useHourly ? (s: string) => fmtHour(s) : (s: string) => fmtDate(s);

  return (
    <section className="panel">
      <h2 className="panel-title">Token Trend ({useHourly ? "Hourly" : "Daily"})</h2>
      <div className="chart-container">
        <LineChart points={trendPoints} />
      </div>
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-swatch" style={{ background: "var(--accent-cyan)" }} />Total</span>
      </div>
      <div className="chart-container" style={{ marginTop: 12 }}>
        <StackedBarChart rows={stackRows} />
      </div>
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-swatch" style={{ background: "var(--accent-red)" }} />Output</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: "var(--accent-cyan)" }} />Input</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: "var(--accent-emerald)" }} />Cache</span>
      </div>
      <table className="data-table" style={{ marginTop: 8 }}>
        <thead><tr><th>{dateCol}</th><th className="num">Total</th><th className="num">Input</th><th className="num">Output</th><th className="num">Cost</th><th className="num">Δ</th></tr></thead>
        <tbody>
          {sorted.slice(0, 20).map((d, i) => {
            const prev = sorted[i + 1];
            return (
              <tr key={d.date}>
                <td>{labelFn(d.date)}</td>
                <td className="num" title={fmtFull(d.total_tokens)}>{fmt(d.total_tokens)}</td>
                <td className="num" title={fmtFull(d.input_tokens)}>{fmt(d.input_tokens)}</td>
                <td className="num" title={fmtFull(d.output_tokens)}>{fmt(d.output_tokens)}</td>
                <td className="num" title={fmtCostFull(d.costs)}>{fmtCost(d.costs)}</td>
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
        <thead><tr><th>Agent</th><th className="num">Tokens</th><th className="num">Share</th><th className="num">Cost</th><th className="num">Messages</th></tr></thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.name}>
              <td>{a.name}</td>
              <td className="num" title={fmtFull(a.total_tokens)}>{fmt(a.total_tokens)}</td>
              <td className="num">{totalSum > 0 ? ((a.total_tokens / totalSum) * 100).toFixed(1) : "0"}%</td>
              <td className="num" title={fmtCostFull(a.costs)}>{fmtCost(a.costs)}</td>
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
        <thead><tr><th>Agent</th><th>Model</th><th className="num">Total</th><th className="num">Input</th><th className="num">Cache Read</th><th className="num">Cost</th><th className="num">Messages</th></tr></thead>
        <tbody>
          {rows.slice(0, 30).map((r) => (
            <tr key={`${r.agent}|${r.model}`}>
              <td>{r.agent}</td>
              <td>{r.model}</td>
              <td className="num" title={fmtFull(r.total_tokens)}>{fmt(r.total_tokens)}</td>
              <td className="num" title={fmtFull(r.input_tokens)}>{fmt(r.input_tokens)}</td>
              <td className="num" title={fmtFull(r.cache_read_tokens)}>{fmt(r.cache_read_tokens)}</td>
              <td className="num" title={fmtCostFull(r.costs)}>{fmtCost(r.costs)}</td>
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
        <thead><tr><th>Session</th><th>Agent</th><th>Model</th><th className="num">Tokens</th><th className="num">Cost</th><th className="num">Messages</th></tr></thead>
        <tbody>
          {sessions.slice(0, 20).map((s) => (
            <tr key={s.session_id}>
              <td className="mono" title={s.title || s.session_id}>{s.title || s.session_id.slice(0, 20)}</td>
              <td>{s.agent || "—"}</td>
              <td>{s.model || "—"}</td>
              <td className="num" title={fmtFull(s.total_tokens)}>{fmt(s.total_tokens)}</td>
              <td className="num" title={fmtCostFull(s.costs)}>{fmtCost(s.costs)}</td>
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
const REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5 },
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
] as const;

function App() {
  const [days, setDays] = useState(7);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [refreshSec, setRefreshSec] = useState(15);
  const refreshMs = refreshSec > 0 ? (refreshSec * 1000) as number : false;
  const health = useHealth();
  const summary = useSummary(days, granularity, refreshMs);

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
          <select
            className="days-selector"
            value={refreshSec}
            onChange={(e) => setRefreshSec(Number(e.target.value))}
            title="Auto-refresh interval"
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>Auto: {o.label}</option>
            ))}
          </select>
          <span className="last-updated">
            {summary.dataUpdatedAt ? `Last: ${new Date(summary.dataUpdatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "—"}
          </span>
          <select className="days-selector" value={days} onChange={(e) => {
            const v = Number(e.target.value);
            setDays(v);
            if (v > 7) setGranularity("day");
          }}>
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <select className="days-selector" value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)}>
            <option value="day">By Day</option>
            <option value="hour" disabled={days > 7}>By Hour{days > 7 ? " (≤7d)" : ""}</option>
          </select>
          <button type="button" className={`btn-refresh${summary.isFetching ? " refreshing" : ""}`} onClick={() => summary.refetch()}>
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
            <TrendSection daily={data.daily} hourly={data.hourly} granularity={granularity} />
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
