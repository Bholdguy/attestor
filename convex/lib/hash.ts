// SHA-256 helpers used on BOTH the live and fixture paths so the stored
// integrity hash (raw_payload_sha256, M7 / AC14) is computed identically
// regardless of source. Convex's default runtime exposes Web Crypto.

const encoder = new TextEncoder();

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const src = typeof input === "string" ? encoder.encode(input) : input;
  // Copy into a fresh ArrayBuffer-backed view — satisfies BufferSource across
  // the TS lib variations without a lossy cast.
  const bytes = new Uint8Array(src.byteLength);
  bytes.set(src);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Byte length of a UTF-8 string (raw_payload_bytes). */
export function utf8Bytes(input: string): number {
  return encoder.encode(input).length;
}

/** First ≤4096 chars, inline on the snapshot for instant timeline rendering (D-8). */
export const EXCERPT_MAX_CHARS = 4096;
export function excerpt(input: string): string {
  return input.slice(0, EXCERPT_MAX_CHARS);
}
