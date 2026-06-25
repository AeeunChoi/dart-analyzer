import { getFinancials, getDisclosures } from "@/lib/dart";
import { getNews } from "@/lib/news";
import { getStockPrices } from "@/lib/stock";

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
    if (!result.corp) {
      return Response.json(result, { status: 404 });
    }

    // 회사를 찾았으면 공시·뉴스·주가도 병렬로 가져온다 (실패해도 재무 결과는 유지)
    const [disclosures, news, stock] = await Promise.all([
      getDisclosures(result.corp.corp_code).catch(() => []),
      getNews(result.corp.corp_name).catch(() => []),
      getStockPrices(result.corp.stock_code).catch(() => null),
    ]);

    return Response.json({ ...result, disclosures, news, stock });
  } catch (e) {
    const message = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return Response.json({ error: message }, { status: 500 });
  }
}
