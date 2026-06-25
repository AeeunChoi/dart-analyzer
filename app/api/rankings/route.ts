import { getRankings } from "@/lib/rankings";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const r = await getRankings();
    if (!r) return Response.json({ error: "순위를 불러오지 못했습니다." }, { status: 200 });
    return Response.json(r);
  } catch {
    return Response.json({ error: "순위 조회 중 오류가 발생했습니다." }, { status: 200 });
  }
}
