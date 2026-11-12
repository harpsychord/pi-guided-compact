import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_CONFIG, type PiGuidedCompactConfig } from "./types.ts";

/**
 * Config lives in a dedicated file so we do not depend on Pi's
 * settings.json tolerating unknown keys (open item O2). Global file is
 * in the agent dir; an optional project file overrides field by field.
 */
export function configPath(cwd: string, scope: "global" | "project"): string {
  const globalDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return scope === "global" ? join(globalDir, "pi-guided-compact.json") : join(cwd, ".pi", "pi-guided-compact.json");
}

function readJson(file: string): Partial<PiGuidedCompactConfig> | null {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw && typeof raw === "object") return raw as Partial<PiGuidedCompactConfig>;
    return null;
  } catch {
    return null;
  }
}

function asPositiveInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Global config, with project config overriding field by field. */
export function loadConfig(cwd: string): PiGuidedCompactConfig {
  const g = readJson(configPath(cwd, "global")) ?? {};
  const p = readJson(configPath(cwd, "project")) ?? {};
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : typeof g.enabled === "boolean" ? g.enabled : DEFAULT_CONFIG.enabled,
    totalCharCap: asPositiveInt(p.totalCharCap, asPositiveInt(g.totalCharCap, DEFAULT_CONFIG.totalCharCap)),
    perFileCharCap: asPositiveInt(p.perFileCharCap, asPositiveInt(g.perFileCharCap, DEFAULT_CONFIG.perFileCharCap)),
    outputMaxTokens: asPositiveInt(p.outputMaxTokens, asPositiveInt(g.outputMaxTokens, DEFAULT_CONFIG.outputMaxTokens)),
  };
}

/** Write a partial update to the global config file (used by /compact-config). */
export function saveGlobalConfig(cwd: string, patch: Partial<PiGuidedCompactConfig>): PiGuidedCompactConfig {
  const path = configPath(cwd, "global");
  const current = readJson(path) ?? {};
  const next: PiGuidedCompactConfig = { ...current, ...patch } as PiGuidedCompactConfig;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}
