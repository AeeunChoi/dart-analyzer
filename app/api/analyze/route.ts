import { analyzeCompany, type AnalyzePayload } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as AnalyzePayload;
    if (!payload?.corp || !Array.isArray(payload?.years)) {
      return Response.json({ error: "분석에 필요한 데이터가 부족합니다." }, { status: 400 });
    }
    const analysis = await analyzeCompany(payload);
    return Response.json(analysis);
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI 분석 중 오류가 발생했습니다.";
    return Response.json({ error: message }, { status: 500 });
  }
}
