import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** HttpError keeps its status. ZodError is a bad request. Anything else is a 500 (logged). */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return Response.json({ error: e.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  console.error(e);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
