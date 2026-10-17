import 'dotenv/config';

function number(name: string, fallback: number, minimum = 0): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid ${name}`);
  return value;
}
export function config() {
  const names = (process.env.BOT_NAMES ?? 'Alice,Bob').split(',').map(s => s.trim());
  if (names.some(n => !/^[A-Za-z0-9_]{1,16}$/.test(n)) || new Set(names).size !== names.length)
    throw new Error('BOT_NAMES must be unique Minecraft usernames');
  const mode = process.env.DECISION_MODE ?? 'jev';
  if (!['jev', 'llm', 'rules'].includes(mode)) throw new Error('Invalid DECISION_MODE');
  const auth = process.env.MC_AUTH ?? 'offline';
  if (!['offline', 'microsoft'].includes(auth)) throw new Error('Invalid MC_AUTH');
  return {
    names, mode: mode as 'jev' | 'llm' | 'rules',
    host: process.env.MC_HOST ?? '127.0.0.1', port: number('MC_PORT', 25565, 1),
    version: process.env.MC_VERSION ?? '1.21.1', auth: auth as 'offline' | 'microsoft',
    follow: process.env.FOLLOW_PLAYER ?? '',
    runSeconds: number('RUN_SECONDS', 300, 1), tickMs: number('DECISION_INTERVAL_MS', 1000, 100),
    selectorApiMs:number('JEV_TIMEOUT_MS',5000,1000),
    longPlanMs:number('LONG_PLAN_INTERVAL_MS',180000,30000),reflectionMs:number('REFLECTION_INTERVAL_MS',60000,10000),socialMs:number('SOCIAL_INTERVAL_MS',30000,1000),
    planMs: number('PLAN_INTERVAL_MS', 45000, 1000), actionMs: number('ACTION_TIMEOUT_MS', 20000, 100),
    apiMs: number('API_TIMEOUT_MS', 120000, 100), maxCalls: number('MAX_API_CALLS', 500, 1),
    maxUsd: number('MAX_ESTIMATED_USD', 2, 0.001),
    llmUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    llmModel: process.env.LLM_MODEL ?? 'gpt-6-luna', llmKey: process.env.LLM_API_KEY ?? '',
    // Conservative peak, uncached estimates. Update when changing providers/models.
    inputRate: number('LLM_INPUT_USD_PER_MTOK', 0.10), outputRate: number('LLM_OUTPUT_USD_PER_MTOK', 0.50),
    maxOutput: number('LLM_MAX_OUTPUT_TOKENS', 512, 32),
    jevUrl: process.env.JEV_BASE_URL ?? 'https://api.typesafe.ai/v1',
    jevModel: process.env.JEV_MODEL ?? 'jev-1.14.0', jevKey: process.env.JEV_API_KEY ?? '',
    jevRate: number('JEV_INPUT_USD_PER_MTOK', 0.042), minConfidence: number('MIN_CONFIDENCE', 0.55),
  };
}
export type Config = ReturnType<typeof config>;
