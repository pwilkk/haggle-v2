const KEY = "haggle.sessionId";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let fallbackId: string | null = null;

/** The only value this app writes to the browser. */
export function getSessionId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && UUID.test(existing)) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    fallbackId ??= crypto.randomUUID();
    return fallbackId;
  }
}
