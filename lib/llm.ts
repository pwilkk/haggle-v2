import "server-only";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { HttpError } from "./http";

/** The only place the model id lives. */
export const MODEL = process.env.XAI_MODEL || "grok-4.7";

// A placeholder lets `next build` import this module when no key is configured.
// A real call still fails until XAI_API_KEY is set, and the route turns that into a 502.
export const llm = new OpenAI({
  apiKey: process.env.XAI_API_KEY || "missing",
  baseURL: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  timeout: 20_000,
  maxRetries: 1,
});

const AGENT_FAILED = "The buying agent failed to reply. Try again.";

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Send messages plus a tool list to Grok, run any tools it calls, feed the
 * results back, and repeat until it answers in plain text.
 */
export async function runAgent(opts: {
  system: string;
  messages: ChatCompletionMessageParam[];
  tools: ToolDef[];
  maxSteps?: number;
  stopAfterTools?: string[];
}): Promise<{ text: string; messages: ChatCompletionMessageParam[]; stoppedBy?: string }> {
  const { system, tools } = opts;
  const messages = [...opts.messages];
  const toolSpec: ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    const res = await llm.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      tools: toolSpec,
      tool_choice: "auto",
      temperature: 0.6,
    });
    const msg = res.choices[0]?.message;
    if (!msg) return { text: "", messages };
    messages.push(msg);

    if (!msg.tool_calls?.length) return { text: (msg.content ?? "").trim(), messages };

    let stoppedBy: string | undefined;
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const tool = tools.find((t) => t.name === call.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      let result: unknown;
      try {
        result = tool ? await tool.run(args) : { error: `Unknown tool ${call.function.name}` };
      } catch (e) {
        result = { error: e instanceof Error ? e.message : "Tool failed" };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      const ok = !(result && typeof result === "object" && "error" in result);
      if (ok && opts.stopAfterTools?.includes(call.function.name)) stoppedBy = call.function.name;
    }
    if (stoppedBy) return { text: "", messages, stoppedBy };
  }
  return { text: "", messages };
}

/** JSON completion validated with Zod. One retry, then 502. Temperature default 0. */
export async function completeJSON<T>(
  schema: z.ZodType<T>,
  messages: ChatCompletionMessageParam[],
  opts?: { temperature?: number },
): Promise<T> {
  const temperature = opts?.temperature ?? 0;
  try {
    return await completeOnce(schema, messages, temperature);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const reason = error instanceof Error ? error.message : "Invalid JSON";
    try {
      return await completeOnce(
        schema,
        [
          ...messages,
          {
            role: "user",
            content: `Your previous reply failed validation: ${reason}. Reply with JSON only.`,
          },
        ],
        temperature,
      );
    } catch (again) {
      if (again instanceof HttpError) throw again;
      console.error(again instanceof Error ? again.message : again);
      throw new HttpError(502, AGENT_FAILED);
    }
  }
}

async function completeOnce<T>(
  schema: z.ZodType<T>,
  messages: ChatCompletionMessageParam[],
  temperature: number,
): Promise<T> {
  let content = "";
  try {
    const res = await llm.chat.completions.create({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature,
    });
    const raw = res.choices[0]?.message?.content;
    content = typeof raw === "string" ? raw : "";
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error(error instanceof Error ? error.message : error);
    throw new HttpError(502, AGENT_FAILED);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

/** Plain text completion. Temperature default 0.3. */
export async function completeText(
  messages: ChatCompletionMessageParam[],
  opts?: { temperature?: number },
): Promise<string> {
  try {
    const res = await llm.chat.completions.create({
      model: MODEL,
      messages,
      temperature: opts?.temperature ?? 0.3,
    });
    const raw = res.choices[0]?.message?.content;
    const text = (typeof raw === "string" ? raw : "").trim();
    if (!text) throw new Error("Empty reply");
    return text;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error(error instanceof Error ? error.message : error);
    throw new HttpError(502, AGENT_FAILED);
  }
}
