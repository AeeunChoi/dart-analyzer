import { getFinancials } from "@/lib/dart";

// 이 라우트는 외부 API를 호출하므로 Node 런타임 + 넉넉한 시간 제한을 둔다.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name");
  if (!name || !name.trim()) {
    return Response.json({ error: "회사명을 입력하세요." }, { status: 400 });
  }

  try {
    const result = await getFinancials(name);
    const status = "error" in result && result.error ? 404 : 200;
    return Response.json(result, { status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return Response.json({ error: message }, { status: 500 });
  }
}
