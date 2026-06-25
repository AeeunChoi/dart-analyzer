// 공공데이터포털 금융위원회_주식시세정보 API로 일별 주가를 가져온다. (무료·공식)
// 키가 없으면 조용히 null을 반환해 다른 기능에 영향을 주지 않는다.
const STOCK_BASE =
  "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";

export type StockPoint = {
  date: string; // YYYYMMDD
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
};

export type StockInfo = {
  name: string;
  latest: {
    date: string;
    close: number;
    change: number; // 전일 대비
    changeRate: number; // 등락률 %
    marketCap: number | null; // 시가총액(원)
    shares: number | null; // 상장주식수
  } | null;
  series: StockPoint[]; // 과거 → 최신
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

type RawItem = Record<string, string>;

export async function getStockPrices(stockCode: string): Promise<StockInfo | null> {
  const key = process.env.STOCK_API_KEY;
  if (!key || !/^\d{6}$/.test(stockCode)) return null;

  const end = new Date();
  const begin = new Date();
  begin.setMonth(begin.getMonth() - 6); // 최근 6개월

  const params = new URLSearchParams({
    serviceKey: key, // Decoding 키 → URLSearchParams가 알아서 인코딩
    resultType: "json",
    numOfRows: "300",
    pageNo: "1",
    beginBasDt: ymd(begin),
    endBasDt: ymd(end),
    likeSrtnCd: stockCode,
  });

  let data: unknown;
  try {
    const res = await fetch(`${STOCK_BASE}?${params.toString()}`);
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const items = (data as { response?: { body?: { items?: { item?: RawItem[] | RawItem } } } })?.response
    ?.body?.items?.item;
  const list: RawItem[] = Array.isArray(items) ? items : items ? [items] : [];
  // likeSrtnCd가 접두 매칭이므로 정확히 일치하는 종목만
  const rows = list.filter((it) => (it.srtnCd ?? "").trim() === stockCode);
  if (rows.length === 0) return null;

  const num = (v: string | undefined) => {
    const n = Number((v ?? "").replace(/,/g, ""));
    return Number.isNaN(n) ? 0 : n;
  };

  const series: StockPoint[] = rows
    .map((it) => ({
      date: (it.basDt ?? "").trim(),
      close: num(it.clpr),
      open: num(it.mkp),
      high: num(it.hipr),
      low: num(it.lopr),
      volume: num(it.trqu),
    }))
    .filter((p) => p.date && p.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (series.length === 0) return null;

  const last = [...rows].sort((a, b) => (b.basDt ?? "").localeCompare(a.basDt ?? ""))[0];
  const latest = {
    date: (last.basDt ?? "").trim(),
    close: num(last.clpr),
    change: num(last.vs),
    changeRate: num(last.fltRt),
    marketCap: last.mrktTotAmt ? num(last.mrktTotAmt) : null,
    shares: last.lstgStCnt ? num(last.lstgStCnt) : null,
  };

  return { name: (last.itmsNm ?? "").trim(), latest, series };
}
