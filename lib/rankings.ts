// 공공데이터포털 주식시세 API로 "특정 거래일 전체 종목"을 받아
// 시가총액·거래량·거래대금 TOP10을 만든다. (날짜별 메모리 캐시)
const STOCK_BASE =
  "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";

export type Rank = { name: string; code: string; value: number };
export type Rankings = {
  date: string;
  marketCap: Rank[];
  volume: Rank[];
  tradeValue: Rank[];
};

let cache: { date: string; data: Rankings } | null = null;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function num(v: string | undefined): number {
  const n = Number((v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

type RawItem = Record<string, string>;

async function latestDate(key: string): Promise<string | null> {
  const end = new Date();
  const beg = new Date();
  beg.setDate(beg.getDate() - 12);
  const p = new URLSearchParams({
    serviceKey: key,
    resultType: "json",
    numOfRows: "12",
    pageNo: "1",
    beginBasDt: ymd(beg),
    endBasDt: ymd(end),
    likeSrtnCd: "005930", // 삼성전자(항상 거래) 기준 최근 거래일
  });
  const res = await fetch(`${STOCK_BASE}?${p.toString()}`);
  if (!res.ok) return null;
  const d = await res.json();
  const items = d?.response?.body?.items?.item;
  const list: RawItem[] = Array.isArray(items) ? items : items ? [items] : [];
  const dates = list.map((i) => (i.basDt ?? "").trim()).filter(Boolean).sort((a, b) => b.localeCompare(a));
  return dates[0] ?? null;
}

export async function getRankings(): Promise<Rankings | null> {
  const key = process.env.STOCK_API_KEY;
  if (!key) return null;

  let date: string | null;
  try {
    date = await latestDate(key);
  } catch {
    return null;
  }
  if (!date) return null;
  if (cache && cache.date === date) return cache.data;

  const p = new URLSearchParams({
    serviceKey: key,
    resultType: "json",
    numOfRows: "3000",
    pageNo: "1",
    basDt: date,
  });

  let raw: unknown;
  try {
    const res = await fetch(`${STOCK_BASE}?${p.toString()}`);
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }

  const items = (raw as { response?: { body?: { items?: { item?: RawItem[] | RawItem } } } })?.response?.body
    ?.items?.item;
  const list: RawItem[] = Array.isArray(items) ? items : items ? [items] : [];

  const rows = list
    .filter((it) => !/우[A-Z0-9]?$/.test((it.itmsNm ?? "").trim())) // 우선주 제외
    .map((it) => ({
      name: (it.itmsNm ?? "").trim(),
      code: (it.srtnCd ?? "").trim(),
      mcap: num(it.mrktTotAmt),
      vol: num(it.trqu),
      val: num(it.trPrc),
    }))
    .filter((r) => r.code && r.name);

  const top = (sel: (r: (typeof rows)[number]) => number): Rank[] =>
    [...rows]
      .sort((a, b) => sel(b) - sel(a))
      .slice(0, 10)
      .map((r) => ({ name: r.name, code: r.code, value: sel(r) }));

  const data: Rankings = {
    date,
    marketCap: top((r) => r.mcap),
    volume: top((r) => r.vol),
    tradeValue: top((r) => r.val),
  };
  cache = { date, data };
  return data;
}
