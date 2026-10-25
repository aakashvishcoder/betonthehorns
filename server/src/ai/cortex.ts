// Snowflake Cortex (OpenAI-compatible Chat Completions), authenticated with a programmatic access token.
// Env (server/.env): SNOWFLAKE_ACCOUNT (e.g. myorg-myaccount), SNOWFLAKE_PAT.

export type SnowflakeAuth = { account: string; token: string };

export function snowflakeAuthFromEnv(): SnowflakeAuth | null {
  const account = process.env.SNOWFLAKE_ACCOUNT?.trim();
  const token = process.env.SNOWFLAKE_PAT?.trim();
  return account && token ? { account, token } : null;
}

export const snowflakeHost = (account: string) => `https://${account.toLowerCase().replaceAll("_", "-")}.snowflakecomputing.com`;

export const snowflakeHeaders = (auth: SnowflakeAuth) => ({
  Authorization: `Bearer ${auth.token}`,
  "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
  "Content-Type": "application/json",
  Accept: "application/json",
});

export type Move = { action: "fold" | "check" | "call" | "raise"; amount?: number };

const MOVE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "poker_move",
    strict: true,
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["fold", "check", "call", "raise"] },
        amount: { type: "integer", description: "Total bet to raise to; only for raise" },
      },
      required: ["action", "amount"],
      additionalProperties: false,
    },
  },
};

/** Pulls {"action": ..., "amount": ...} out of a model reply, tolerating extra text. */
export function parseMove(text: string): Move | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as { action?: unknown; amount?: unknown };
    if (!["fold", "check", "call", "raise"].includes(String(data.action))) return null;
    return { action: data.action as Move["action"], amount: Number.isFinite(Number(data.amount)) ? Number(data.amount) : undefined };
  } catch {
    return null;
  }
}

/** Models that rejected structured output once are asked for plain JSON afterwards. */
const noSchema = new Set<string>();

export async function cortexMove(
  auth: SnowflakeAuth,
  model: string,
  system: string,
  user: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ move: Move; tokens?: { in: number; out: number } }> {
  const { timeoutMs = 6_000, fetchImpl = fetch } = options;
  const call = (structured: boolean) =>
    fetchImpl(`${snowflakeHost(auth.account)}/api/v2/cortex/v1/chat/completions`, {
      method: "POST",
      headers: snowflakeHeaders(auth),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // Tiny JSON replies keep output cost near zero; reasoning models also think inside this cap.
        max_completion_tokens: model.startsWith("openai-") ? 400 : 60,
        ...(model.startsWith("openai-") ? { reasoning_effort: "minimal" } : { temperature: 0.7 }),
        ...(structured ? { response_format: MOVE_SCHEMA } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  let res = await call(!noSchema.has(model));
  if (res.status === 400 && !noSchema.has(model)) {
    noSchema.add(model);
    res = await call(false);
  }
  if (!res.ok) throw new Error(`Cortex ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const move = parseMove(data.choices?.[0]?.message?.content ?? "");
  if (!move) throw new Error(`Cortex ${model} returned no usable move`);
  return { move, tokens: data.usage && { in: data.usage.prompt_tokens, out: data.usage.completion_tokens } };
}
