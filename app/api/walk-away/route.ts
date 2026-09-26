import { walkAwayNegotiation } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";
import { WalkAwayBody } from "@/lib/schemas";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = WalkAwayBody.parse(await readJson(req));
    await walkAwayNegotiation(body.negotiationId, body.sessionId);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid request");
  }
}
