/**
 * Model cost loading from OpenCode config files.
 *
 * Replaces the old hand-maintained `server/pricing.json`. Costs are read from:
 *   1. Built-in catalog:  ${OPENCODE_MODELS || ~/.cache/opencode/models.json}
 *   2. User config:        ${OPENCODE_CONFIG || ~/.config/opencode/opencode.json}
 *
 * User config overrides the built-in catalog for the same `provider/modelId`.
 *
 * OpenCode `cost` schema (additionalProperties: false, no `currency` field):
 *   { input, output, cache_read?, cache_write?, context_over_200k? }
 * Legacy/user configs may use `cached_input` instead of `cache_read` — normalized here.
 *
 * Currency: OpenCode cost blocks have no currency field (implicitly USD). To preserve
 * the prior CNY grouping for horologium CNY-billed models, we classify by provider/model.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ModelPrice {
  currency: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface TokenUsageForCost {
  input: number;
  output: number;
  reasoning: number;
  cache_read: number;
  cache_write: number;
}

interface RawCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cached_input?: number;
  cache_write?: number;
}

interface IndexedPrice extends ModelPrice {
  providerId: string;
  modelId: string;
}

export interface ModelPriceIndex {
  /** key: `${providerId}/${modelId}` (lowercased) */
  exact: Map<string, IndexedPrice>;
  /** key: modelId only (lowercased), for cross-provider fallback */
  byModelId: Map<string, IndexedPrice>;
  /** key: normalized modelId (lowercased, - and . stripped) for fuzzy match */
  fuzzy: Map<string, IndexedPrice>;
}

/** Models billed in CNY. OpenCode cost schema has no currency field, so we map here. */
const CNY_MODELS = new Set([
  "horologium/glm-5-2",
  "horologium/glm-5.2",
  "horologium/qwen3-7-max",
  "horologium/qwen3.7-max",
  "horologium-claude/kimi-2-7",
]);

function currencyFor(providerId: string, modelId: string): string {
  if (CNY_MODELS.has(`${providerId}/${modelId}`)) return "CNY";
  return "USD";
}

export function resolveOpenCodeConfigPath(): string {
  return process.env.OPENCODE_CONFIG || join(homedir(), ".config", "opencode", "opencode.json");
}

export function resolveOpenCodeModelsPath(): string {
  return process.env.OPENCODE_MODELS || join(homedir(), ".cache", "opencode", "models.json");
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRawCost(providerId: string, modelId: string, raw: RawCost): ModelPrice | null {
  // input and output are required by OpenCode schema; skip if absent
  if (raw.input === undefined || raw.output === undefined) return null;
  return {
    currency: currencyFor(providerId, modelId),
    input: num(raw.input),
    output: num(raw.output),
    cache_read: num(raw.cache_read ?? raw.cached_input ?? 0),
    cache_write: num(raw.cache_write ?? 0),
  };
}

function fuzzyKey(value: string): string {
  return value.toLowerCase().replace(/[-.]/g, "");
}

function addEntry(index: ModelPriceIndex, providerId: string, modelId: string, price: ModelPrice): void {
  const entry: IndexedPrice = { ...price, providerId, modelId };
  const pLower = providerId.toLowerCase();
  const mLower = modelId.toLowerCase();
  index.exact.set(`${pLower}/${mLower}`, entry);
  // Only set byModelId if not already present (first provider wins for ambiguous IDs)
  if (!index.byModelId.has(mLower)) index.byModelId.set(mLower, entry);
  // Only set fuzzy if not already present
  const fk = fuzzyKey(modelId);
  if (!index.fuzzy.has(fk)) index.fuzzy.set(fk, entry);
}

/**
 * Load model prices from OpenCode config + built-in catalog.
 * Missing files or malformed JSON are logged to stderr and skipped — never throws.
 */
export function loadModelPrices(): ModelPriceIndex {
  const index: ModelPriceIndex = { exact: new Map(), byModelId: new Map(), fuzzy: new Map() };

  // 1. Built-in catalog (loaded first; user config overrides)
  const modelsPath = resolveOpenCodeModelsPath();
  if (existsSync(modelsPath)) {
    try {
      const raw = JSON.parse(readFileSync(modelsPath, "utf8")) as Record<string, unknown>;
      for (const [providerId, provider] of Object.entries(raw)) {
        if (!provider || typeof provider !== "object") continue;
        const models = (provider as any).models;
        if (!models || typeof models !== "object") continue;
        for (const [modelId, model] of Object.entries(models)) {
          const cost = (model as any)?.cost;
          if (!cost || typeof cost !== "object") continue;
          const price = normalizeRawCost(providerId, modelId, cost as RawCost);
          if (price) addEntry(index, providerId, modelId, price);
        }
      }
    } catch (e) {
      console.error(`[model-costs] failed to parse ${modelsPath}:`, e);
    }
  }

  // 2. User config (overrides built-in for same provider/model)
  const configPath = resolveOpenCodeConfigPath();
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf8")) as any;
      const providers = raw?.provider;
      if (providers && typeof providers === "object") {
        for (const [providerId, provider] of Object.entries(providers)) {
          const models = (provider as any)?.models;
          if (!models || typeof models !== "object") continue;
          for (const [modelId, model] of Object.entries(models)) {
            const cost = (model as any)?.cost;
            if (!cost || typeof cost !== "object") continue;
            const price = normalizeRawCost(providerId, modelId, cost as RawCost);
            if (price) addEntry(index, providerId, modelId, price);
          }
        }
      }
    } catch (e) {
      console.error(`[model-costs] failed to parse ${configPath}:`, e);
    }
  }

  return index;
}

export function lookupPrice(
  index: ModelPriceIndex,
  providerId: string,
  modelId: string,
): ModelPrice | null {
  if (!modelId) return null;
  const pLower = providerId.toLowerCase();
  const mLower = modelId.toLowerCase();

  // 1. exact provider/model
  const exact = index.exact.get(`${pLower}/${mLower}`);
  if (exact) return exact;

  // 2. exact modelId only
  const byModel = index.byModelId.get(mLower);
  if (byModel) return byModel;

  // 3. fuzzy: strip - and .
  const fk = fuzzyKey(modelId);
  const fuzzy = index.fuzzy.get(fk);
  if (fuzzy) return fuzzy;

  return null;
}

export function computeCost(tokens: TokenUsageForCost, price: ModelPrice): number {
  return (
    (tokens.input * price.input) / 1_000_000 +
    (tokens.output * price.output) / 1_000_000 +
    (tokens.reasoning * price.output) / 1_000_000 + // reasoning charged at output rate (matches OpenCode behavior)
    (tokens.cache_read * price.cache_read) / 1_000_000 +
    (tokens.cache_write * price.cache_write) / 1_000_000
  );
}
