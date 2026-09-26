import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const create = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = { completions: { create } };
  },
}));

import { HttpError } from "@/lib/http";
import { completeJSON, completeText } from "@/lib/llm";

const schema = z.object({ ok: z.boolean() });

function jsonReply(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  create.mockReset();
});

describe("completeJSON", () => {
  it("parses a JSON object with the schema at temperature 0", async () => {
    create.mockResolvedValueOnce(jsonReply('{"ok":true}'));
    await expect(completeJSON(schema, [{ role: "user", content: "JSON please" }])).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      temperature: 0,
      response_format: { type: "json_object" },
    });
  });

  it("retries once with the validation error, then returns the fixed JSON", async () => {
    create.mockResolvedValueOnce(jsonReply("not json")).mockResolvedValueOnce(jsonReply('{"ok":true}'));
    await expect(completeJSON(schema, [{ role: "user", content: "JSON please" }])).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    const retried = create.mock.calls[1]?.[0].messages as Array<{ role: string; content: string }>;
    expect(retried.at(-1)).toMatchObject({ role: "user" });
    expect(retried.at(-1)?.content).toContain("failed validation");
  });

  it("throws 502 when the retry is still invalid", async () => {
    create.mockResolvedValue(jsonReply('{"ok":"no"}'));
    await expect(completeJSON(schema, [{ role: "user", content: "JSON please" }])).rejects.toBeInstanceOf(HttpError);
    await expect(completeJSON(schema, [{ role: "user", content: "JSON please" }])).rejects.toMatchObject({ status: 502 });
  });

  it("throws 502 on a transport error without a validation retry", async () => {
    create.mockRejectedValue(new Error("network down"));
    await expect(completeJSON(schema, [{ role: "user", content: "JSON please" }])).rejects.toMatchObject({ status: 502 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("completeText", () => {
  it("returns trimmed text at temperature 0.3", async () => {
    create.mockResolvedValueOnce(jsonReply("  Hello there  "));
    await expect(completeText([{ role: "user", content: "Hi" }])).resolves.toBe("Hello there");
    expect(create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0.3 });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("response_format");
  });

  it("throws 502 when the reply is empty or the call fails", async () => {
    create.mockResolvedValueOnce(jsonReply("   "));
    await expect(completeText([{ role: "user", content: "Hi" }])).rejects.toMatchObject({ status: 502 });
    create.mockRejectedValueOnce(new Error("network down"));
    await expect(completeText([{ role: "user", content: "Hi" }])).rejects.toMatchObject({ status: 502 });
  });
});
