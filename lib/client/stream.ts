/** Read an NDJSON body. The last line may omit the trailing newline. */
export async function readNdjson<T>(res: Response, onEvent: (event: T) => void): Promise<void> {
  if (!res.body) throw new Error("No stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line) as T);
    }
  }

  buf += decoder.decode();
  const rest = buf.trim();
  if (rest) onEvent(JSON.parse(rest) as T);
}
