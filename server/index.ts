import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { computeSummary } from "./summary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.OPENCODE_DB || join(process.env.HOME || "~", ".local/share/opencode/opencode.db");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 12580);

async function main() {
  const app = express();
  app.use(cors());

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      db_path: DB_PATH,
      db_exists: existsSync(DB_PATH),
      now: new Date().toISOString(),
      now_ms: Date.now(),
    });
  });

  app.get("/api/summary", (req, res) => {
    const rawDays = Number(req.query.days);
    const requestedDays = Number.isFinite(rawDays) ? rawDays : 7;
    const days = Math.max(1, Math.min(requestedDays, 90));
    try {
      res.json(computeSummary(days));
    } catch (err: any) {
      res.status(500).json({ status: "error", error: err.message });
    }
  });

  if (process.env.NODE_ENV === "production") {
    const clientDir = join(__dirname, "..", "client");
    app.use(express.static(clientDir));
    app.get("/", (_req, res) => res.sendFile(join(clientDir, "index.html")));
  }

  app.listen(PORT, HOST, () => {
    console.log(`OpenCode token dashboard: http://${HOST}:${PORT}`);
    console.log(`DB: ${DB_PATH} (exists=${existsSync(DB_PATH)})`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
