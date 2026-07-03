import { query, type DbRow } from "./db.js";

const TOKEN_KEYS = ["input", "output", "reasoning", "cache_read", "cache_write"] as const;

function newBucket() {
  return { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, assistant_messages: 0 };
}

function addTokens(bucket: any, tokens: any, messages = 1) {
  for (const key of TOKEN_KEYS) {
    bucket[key] += Number(tokens[key] || 0);
  }
  bucket.assistant_messages += messages;
}

function totalTokens(bucket: any): number {
  return TOKEN_KEYS.reduce((sum, key) => sum + Number(bucket[key] || 0), 0);
}

function exposeTokens(bucket: any): any {
  return {
    ...bucket,
    input_tokens: bucket.input,
    output_tokens: bucket.output,
    reasoning_tokens: bucket.reasoning,
    cache_read_tokens: bucket.cache_read,
    cache_write_tokens: bucket.cache_write,
    tokens: totalTokens(bucket),
    total_tokens: totalTokens(bucket),
    messages: bucket.assistant_messages,
  };
}

function modelFromSession(raw: string | null): [string, string] {
  if (!raw) return ["", ""];
  try {
    const data = JSON.parse(raw);
    return [String(data.providerID || ""), String(data.id || data.modelID || "")];
  } catch {
    return ["", ""];
  }
}

function startOfLocalDay(days: number): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  return start.getTime();
}


function localDateKey(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compactCounter(counter: Map<string, number>, keyName = "name", limit = 30) {
  const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return sorted.map(([name, count]) => ({ [keyName]: name, name, count }));
}

export function computeSummary(days: number): any {
  const nowMs = Date.now();
  const cutoffMs = startOfLocalDay(days);

  const totals: any = newBucket();
  const totalsSessions = new Set<string>();
  const byDay = new Map<string, any>();
  const daySessions = new Map<string, Set<string>>();
  const byAgent = new Map<string, any>();
  const byAgentModel = new Map<string, any>();
  const bySession = new Map<string, any>();
  const emptySessionIds = new Set<string>();
  const recoveredSessionIds = new Set<string>();

  const taskDelegations = new Map<string, number>();
  const taskSkills = new Map<string, number>();
  const directSkills = new Map<string, number>();
  let noLoadSkills = 0;
  let taskCalls = 0;

  function bump(map: Map<string, number>, key: string) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  function getOrCreate(map: Map<string, any>, key: string, factory: () => any): any {
    if (!map.has(key)) map.set(key, factory());
    return map.get(key);
  }

  // Extract token fields directly in SQL to avoid parsing raw JSON blobs
  const rows = query<DbRow>(
    `SELECT
       m.session_id AS session_id,
       m.time_created AS time_created,
       json_extract(m.data, '$.role') AS role,
       json_extract(m.data, '$.agent') AS msg_agent,
       json_extract(m.data, '$.mode') AS msg_mode,
       json_extract(m.data, '$.providerID') AS provider_id,
       json_extract(m.data, '$.modelID') AS model_id,
       json_extract(m.data, '$.tokens.input') AS tok_input,
       json_extract(m.data, '$.tokens.output') AS tok_output,
       json_extract(m.data, '$.tokens.reasoning') AS tok_reasoning,
       json_extract(m.data, '$.tokens.cache.read') AS tok_cache_read,
       json_extract(m.data, '$.tokens.cache.write') AS tok_cache_write,
       s.title AS title,
       s.agent AS session_agent,
       s.model AS session_model
     FROM message m
     LEFT JOIN session s ON s.id = m.session_id
     WHERE m.time_created >= ?
     ORDER BY m.time_created ASC`,
    [cutoffMs],
  );

  for (const row of rows) {
    if (row.role !== "assistant") continue;

    const tokens = {
      input: Number(row.tok_input || 0),
      output: Number(row.tok_output || 0),
      reasoning: Number(row.tok_reasoning || 0),
      cache_read: Number(row.tok_cache_read || 0),
      cache_write: Number(row.tok_cache_write || 0),
    };
    if (totalTokens(tokens) <= 0) continue;

    const sessionAgent = String(row.session_agent || "");
    const [sessionProvider, sessionModel] = modelFromSession(row.session_model as string | null);
    const msgAgent = String(row.msg_agent || row.msg_mode || "");
    const provider = String(row.provider_id || sessionProvider || "");
    const modelId = String(row.model_id || sessionModel || "");
    const agent = msgAgent || sessionAgent || "unknown";
    const modelLabel = provider && modelId ? `${provider}/${modelId}` : modelId || provider || "unknown";
    const sessionId = String(row.session_id);

    if (!sessionAgent) {
      emptySessionIds.add(sessionId);
      if (msgAgent) recoveredSessionIds.add(sessionId);
    }

    const day = localDateKey(Number(row.time_created));
    addTokens(totals, tokens);
    totalsSessions.add(sessionId);
    addTokens(getOrCreate(byDay, day, newBucket), tokens);
    if (!daySessions.has(day)) daySessions.set(day, new Set());
    daySessions.get(day)!.add(sessionId);
    addTokens(getOrCreate(byAgent, agent, newBucket), tokens);
    addTokens(getOrCreate(byAgentModel, `${agent}|${modelLabel}`, newBucket), tokens);

    if (!bySession.has(sessionId)) {
      const item = newBucket();
      Object.assign(item, {
        session_id: sessionId,
        title: String(row.title || ""),
        agent,
        model: modelLabel,
        recovered: !sessionAgent && !!msgAgent,
      });
      bySession.set(sessionId, item);
    }
    addTokens(bySession.get(sessionId)!, tokens);
  }

  // Tool calls from part table — also use json_extract to avoid raw blob
  const partRows = query<DbRow>(
    `SELECT
       json_extract(data, '$.tool') AS tool,
       json_extract(data, '$.state.input.subagent_type') AS subagent_type,
       json_extract(data, '$.state.input.category') AS category,
       json_extract(data, '$.state.input.name') AS skill_name,
       json_extract(data, '$.state.input.load_skills') AS load_skills
     FROM part
     WHERE time_created >= ? AND json_extract(data, '$.type') = 'tool'`,
    [cutoffMs],
  );

  for (const row of partRows) {
    const tool = String(row.tool || "");
    if (tool === "task") {
      taskCalls++;
      if (row.subagent_type) bump(taskDelegations, `subagent:${row.subagent_type}`);
      if (row.category) bump(taskDelegations, `category:${row.category}`);
      // load_skills is a JSON array string like '["a","b"]'
      if (row.load_skills) {
        try {
          const skills = JSON.parse(row.load_skills as string);
          if (Array.isArray(skills) && skills.length) {
            for (const s of skills) if (s) bump(taskSkills, String(s));
          } else {
            noLoadSkills++;
          }
        } catch {
          noLoadSkills++;
        }
      } else {
        noLoadSkills++;
      }
    } else if (tool === "skill") {
      if (row.skill_name) bump(directSkills, String(row.skill_name));
    }
  }

  const totalsExposed = exposeTokens(totals);
  totalsExposed.sessions = totalsSessions.size;
  totalsExposed.task_calls = taskCalls;
  totalsExposed.no_load_skills = noLoadSkills;

  const daily: any[] = [];
  let current = new Date(cutoffMs);
  for (let i = 0; i < days; i++) {
    const key = localDateKey(current);
    const item = exposeTokens(byDay.get(key) || newBucket());
    item.date = key;
    item.sessions = daySessions.get(key)?.size || 0;
    daily.push(item);
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
  }

  const topAgents = [...byAgent.entries()]
    .sort((a, b) => totalTokens(b[1]) - totalTokens(a[1]))
    .slice(0, 30)
    .map(([name, bucket]) => ({ ...exposeTokens(bucket), name, agent: name }));

  const topAgentModels = [...byAgentModel.entries()]
    .sort((a, b) => totalTokens(b[1]) - totalTokens(a[1]))
    .slice(0, 50)
    .map(([key, bucket]) => {
      const [agent, model] = key.split("|");
      return { ...exposeTokens(bucket), name: `${agent} / ${model}`, agent, model };
    });

  const topSessions = [...bySession.values()]
    .sort((a, b) => totalTokens(b) - totalTokens(a))
    .slice(0, 30)
    .map((item) => ({
      ...exposeTokens(item),
      session_id: item.session_id,
      title: item.title,
      agent: item.agent,
      model: item.model,
      recovered: item.recovered,
    }));

  const recoveredPercent = emptySessionIds.size
    ? Math.round((recoveredSessionIds.size / emptySessionIds.size) * 10000) / 100
    : 100.0;

  return {
    status: "ok",
    days,
    cutoff_ms: cutoffMs,
    now_ms: nowMs,
    totals: totalsExposed,
    daily,
    top_agents: topAgents,
    top_agent_models: topAgentModels,
    delegations: compactCounter(taskDelegations, undefined, 30),
    task_skills: compactCounter(taskSkills, "skill", 30),
    direct_skills: compactCounter(directSkills, "skill", 30),
    top_sessions: topSessions,
    recovery: {
      empty_sessions: emptySessionIds.size,
      recovered_sessions: recoveredSessionIds.size,
      recovered_percent: recoveredPercent,
    },
  };
}