import { acceptNegotiation } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/http";
import { AcceptBody } from "@/lib/schemas";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = AcceptBody.parse(await readJson(req));
    const result = await acceptNegotiation(body.negotiationId, body.sessionId);
    return Response.json(result);
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
