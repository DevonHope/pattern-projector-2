// Prefix for root-relative URLs that Next.js does not rewrite on its own
// (plain <a>, next/image string src, manifest). Set at build time with
// NEXT_PUBLIC_BASE_PATH, e.g. "/pattern-projector"; empty by default.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBasePath(path: string): string {
  return path.startsWith("/") ? `${BASE_PATH}${path}` : path;
}
