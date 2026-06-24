import { searchCorps } from "@/lib/dart";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ items: searchCorps(q, 8) });
}
