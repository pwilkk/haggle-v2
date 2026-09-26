import "server-only";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

/** The only place the model id lives. */
export const MODEL = process.env.XAI_MODEL || "grok-4.7";

export const llm = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  timeout: 20_000,
  maxRetries: 1,
});

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

/** Plain JSON completion. The prompt must ask for JSON. */
export async function completeJSON(system: string, user: string): Promise<unknown> {
  const res = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });
  return JSON.parse(res.choices[0]?.message.content || "{}") as unknown;
}
