"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// 차트는 SSR 충돌을 피하려 클라이언트에서만 로드
const FinancialCharts = dynamic(() => import("./FinancialCharts"), {
  ssr: false,
  loading: () => <p className="py-8 text-center text-sm text-zinc-400">차트 로딩 중…</p>,
});
const StockChart = dynamic(() => import("./StockChart"), {
  ssr: false,
  loading: () => <p className="py-8 text-center text-sm text-zinc-400">차트 로딩 중…</p>,
});

/* ── 타입 ───────────────────────────── */
type YearFinancials = {
  year: number;
  fsDiv: "CFS" | "OFS";
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
  operatingCashFlow: number | null;
};
type CorpMatch = { corp_code: string; corp_name: string; stock_code: string; listed: boolean };
type Disclosure = { report_nm: string; rcept_dt: string; flr_nm: string; rcept_no: string; url: string };
type NewsItem = { title: string; link: string; pubDate: string; source: string };
type StockPoint = { date: string; close: number; open: number; high: number; low: number; volume: number };
type StockInfo = {
  name: string;
  latest: {
    date: string;
    close: number;
    change: number;
    changeRate: number;
    marketCap: number | null;
    shares: number | null;
  } | null;
  series: StockPoint[];
};
type ApiResult = {
  corp?: CorpMatch;
  years?: YearFinancials[];
  disclosures?: Disclosure[];
  news?: NewsItem[];
  stock?: StockInfo | null;
  error?: string;
};
type AiAnalysis = { disclosureSummary: string; newsSummary: string; stockImpact: string; overall: string };
type Suggestion = { corp_name: string; stock_code: string };
type Rank = { name: string; code: string; value: number };
type Rankings = { date: string; marketCap: Rank[]; volume: Rank[]; tradeValue: Rank[] };

/* ── 숫자/날짜 포맷 ───────────────────── */
function toEok(value: number | null): string {
  if (value === null) return "—";
  return (value / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "억";
}
function pct(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "%";
}
function fmtYmd(s: string): string {
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
  return s;
}
function fmtNewsDate(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("ko-KR");
}
function fmtJoEok(v: number): string {
  if (v >= 1e12) return (v / 1e12).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "조";
  return Math.round(v / 1e8).toLocaleString("ko-KR") + "억";
}
function fmtVol(v: number): string {
  if (v >= 1e4) return Math.round(v / 1e4).toLocaleString("ko-KR") + "만주";
  return v.toLocaleString("ko-KR") + "주";
}
const RANK_TABS: { id: "marketCap" | "volume" | "tradeValue"; label: string; fmt: (v: number) => string }[] = [
  { id: "marketCap", label: "시가총액", fmt: fmtJoEok },
  { id: "volume", label: "거래량", fmt: fmtVol },
  { id: "tradeValue", label: "거래대금", fmt: fmtJoEok },
];

/* ── 색코딩(좋음 초록 / 주의 주황 / 나쁨 빨강) ── */
const DEFAULT_NUM = "text-zinc-700 dark:text-zinc-300";
function ratioTone(label: string, v: number): string {
  if (label === "부채비율") return v >= 200 ? "text-red-500" : v >= 150 ? "text-amber-500" : v < 100 ? "text-emerald-600" : "";
  if (label === "자기자본비율") return v >= 50 ? "text-emerald-600" : v < 20 ? "text-red-500" : "";
  // 영업이익률·순이익률·ROE: 높을수록 좋음
  return v < 0 ? "text-red-500" : v >= 10 ? "text-emerald-600" : "";
}
function perTone(per: number | null, loss: boolean): string {
  if (loss) return "text-red-500";
  if (per === null) return "";
  return per < 12 ? "text-emerald-600" : per < 25 ? "" : per < 40 ? "text-amber-500" : "text-red-500";
}
function pbrTone(pbr: number | null): string {
  if (pbr === null) return "";
  return pbr < 1.5 ? "text-emerald-600" : pbr < 3 ? "" : pbr < 4 ? "text-amber-500" : "text-red-500";
}

/* ── 비율 ───────────────────────────── */
function ratio(numer: number | null, denom: number | null): number | null {
  if (numer === null || denom === null || denom === 0) return null;
  return (numer / denom) * 100;
}
function growth(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

/* ── 밸류에이션 (시총·주식수 + 재무로 계산) ── */
type Valuation = {
  per: number | null; // 주가수익비율 = 시총 / 당기순이익
  pbr: number | null; // 주가순자산비율 = 시총 / 자본총계
  eps: number | null; // 주당순이익 = 당기순이익 / 주식수
  bps: number | null; // 주당순자산 = 자본총계 / 주식수
  niYear: number | null; // 기준 재무 연도
  loss: boolean; // 당기순손실 여부
};
function calcValuation(
  stock: StockInfo | null,
  latestYear: YearFinancials | undefined
): Valuation | null {
  if (!stock?.latest || !latestYear) return null;
  const mcap = stock.latest.marketCap;
  const price = stock.latest.close;
  const shares = stock.latest.shares ?? (mcap && price ? Math.round(mcap / price) : null);
  const ni = latestYear.netIncome;
  const eq = latestYear.equity;
  return {
    per: mcap && ni && ni > 0 ? mcap / ni : null,
    pbr: mcap && eq && eq > 0 ? mcap / eq : null,
    eps: ni !== null && shares ? ni / shares : null,
    bps: eq !== null && shares ? eq / shares : null,
    niYear: latestYear.year,
    loss: ni !== null && ni <= 0,
  };
}

const METRIC_ROWS: { key: keyof YearFinancials; label: string }[] = [
  { key: "revenue", label: "매출액" },
  { key: "operatingIncome", label: "영업이익" },
  { key: "netIncome", label: "당기순이익" },
  { key: "assets", label: "자산총계" },
  { key: "liabilities", label: "부채총계" },
  { key: "equity", label: "자본총계" },
  { key: "operatingCashFlow", label: "영업활동현금흐름" },
];
const RATIO_ROWS: {
  label: string;
  desc: string;
  calc: (y: YearFinancials) => number | null;
}[] = [
  { label: "영업이익률", desc: "매출 대비 영업이익", calc: (y) => ratio(y.operatingIncome, y.revenue) },
  { label: "순이익률", desc: "매출 대비 당기순이익", calc: (y) => ratio(y.netIncome, y.revenue) },
  { label: "ROE", desc: "자본 대비 순이익", calc: (y) => ratio(y.netIncome, y.equity) },
  { label: "부채비율", desc: "자본 대비 부채(낮을수록 안정)", calc: (y) => ratio(y.liabilities, y.equity) },
  { label: "자기자본비율", desc: "자산 중 자기자본 비중", calc: (y) => ratio(y.equity, y.assets) },
];
const GROWTH_ITEMS: { key: keyof YearFinancials; label: string }[] = [
  { key: "revenue", label: "매출액" },
  { key: "operatingIncome", label: "영업이익" },
  { key: "netIncome", label: "당기순이익" },
];

/* ── 투자 점수(0~100) 산정 ────────────── */
type CatScore = { key: string; label: string; score: number | null };
type ScoreResult = { total: number; label: string; cats: CatScore[] };

function avg(arr: number[]): number {
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}
function scoreHex(s: number): string {
  return s >= 75 ? "#10b981" : s >= 60 ? "#3b82f6" : s >= 45 ? "#f59e0b" : "#ef4444";
}

function sProfit(y: YearFinancials): number | null {
  const s: number[] = [];
  const opm = ratio(y.operatingIncome, y.revenue);
  const roe = ratio(y.netIncome, y.equity);
  if (opm !== null) s.push(opm < 0 ? 10 : opm < 5 ? 45 : opm < 10 ? 62 : opm < 15 ? 75 : opm < 20 ? 86 : 95);
  if (roe !== null) s.push(roe < 0 ? 10 : roe < 5 ? 45 : roe < 10 ? 62 : roe < 15 ? 76 : roe < 20 ? 88 : 95);
  return s.length ? avg(s) : null;
}
function sGrowth(years: YearFinancials[]): number | null {
  const latest = years[0];
  const oldest = years[years.length - 1];
  const map = (g: number) => (g < -10 ? 25 : g < 0 ? 45 : g < 10 ? 60 : g < 25 ? 75 : g < 50 ? 86 : 95);
  const s: number[] = [];
  const rev = growth(latest.revenue, oldest.revenue);
  const op = growth(latest.operatingIncome, oldest.operatingIncome);
  if (rev !== null) s.push(map(rev));
  if (op !== null) s.push(map(op));
  return s.length ? avg(s) : null;
}
function sStable(y: YearFinancials): number | null {
  const s: number[] = [];
  const debt = ratio(y.liabilities, y.equity);
  const eqr = ratio(y.equity, y.assets);
  if (debt !== null) s.push(debt < 50 ? 95 : debt < 100 ? 84 : debt < 150 ? 70 : debt < 200 ? 55 : debt < 300 ? 38 : 20);
  if (eqr !== null) s.push(eqr > 70 ? 92 : eqr > 50 ? 80 : eqr > 30 ? 66 : eqr > 20 ? 50 : 32);
  return s.length ? avg(s) : null;
}
function sCash(y: YearFinancials): number | null {
  const ocf = y.operatingCashFlow;
  if (ocf === null) return null;
  if (ocf < 0) return 25;
  const m = ratio(ocf, y.revenue);
  if (m === null) return 60;
  return m < 5 ? 55 : m < 10 ? 70 : m < 15 ? 82 : 92;
}
function sValue(v: Valuation | null): number | null {
  if (!v) return null;
  const s: number[] = [];
  if (v.loss) s.push(30);
  else if (v.per !== null) s.push(v.per < 8 ? 92 : v.per < 12 ? 80 : v.per < 18 ? 68 : v.per < 25 ? 55 : v.per < 40 ? 42 : 30);
  if (v.pbr !== null) s.push(v.pbr < 1 ? 92 : v.pbr < 1.5 ? 80 : v.pbr < 2.5 ? 66 : v.pbr < 4 ? 50 : 38);
  return s.length ? avg(s) : null;
}
function calcScore(years: YearFinancials[], valuation: Valuation | null): ScoreResult | null {
  if (!years.length) return null;
  const y = years[0];
  const cats: CatScore[] = [
    { key: "profit", label: "수익성", score: sProfit(y) },
    { key: "growth", label: "성장성", score: years.length > 1 ? sGrowth(years) : null },
    { key: "stable", label: "안정성", score: sStable(y) },
    { key: "cash", label: "현금흐름", score: sCash(y) },
    { key: "value", label: "밸류에이션", score: sValue(valuation) },
  ];
  const weights: Record<string, number> = { profit: 25, growth: 20, stable: 20, cash: 15, value: 20 };
  let acc = 0;
  let wsum = 0;
  for (const c of cats) {
    if (c.score !== null) {
      acc += c.score * weights[c.key];
      wsum += weights[c.key];
    }
  }
  if (wsum === 0) return null;
  const total = Math.round(acc / wsum);
  const label = total >= 75 ? "우수" : total >= 60 ? "양호" : total >= 45 ? "보통" : total >= 30 ? "주의" : "위험";
  return { total, label, cats };
}

/* ── 경쟁사 비교 요약 ─────────────────── */
type CompanySummary = {
  name: string;
  code: string;
  revenue: number | null;
  opIncome: number | null;
  netIncome: number | null;
  opMargin: number | null;
  roe: number | null;
  debt: number | null;
  per: number | null;
  pbr: number | null;
  mcap: number | null;
  score: number | null;
};
function summarize(r: ApiResult): CompanySummary {
  const y = r.years?.[0];
  const val = calcValuation(r.stock ?? null, y);
  const sc = calcScore(r.years ?? [], val);
  return {
    name: r.corp?.corp_name ?? "",
    code: r.corp?.stock_code ?? "",
    revenue: y?.revenue ?? null,
    opIncome: y?.operatingIncome ?? null,
    netIncome: y?.netIncome ?? null,
    opMargin: y ? ratio(y.operatingIncome, y.revenue) : null,
    roe: y ? ratio(y.netIncome, y.equity) : null,
    debt: y ? ratio(y.liabilities, y.equity) : null,
    per: val?.per ?? null,
    pbr: val?.pbr ?? null,
    mcap: r.stock?.latest?.marketCap ?? null,
    score: sc?.total ?? null,
  };
}
const COMPARE_ROWS: {
  label: string;
  get: (s: CompanySummary) => number | null;
  fmt: (v: number | null) => string;
  better: "high" | "low" | null;
}[] = [
  { label: "투자점수", get: (s) => s.score, fmt: (v) => (v !== null ? v + "점" : "—"), better: "high" },
  { label: "시가총액", get: (s) => s.mcap, fmt: (v) => (v !== null ? fmtJoEok(v) : "—"), better: null },
  { label: "매출액", get: (s) => s.revenue, fmt: (v) => toEok(v), better: "high" },
  { label: "영업이익", get: (s) => s.opIncome, fmt: (v) => toEok(v), better: "high" },
  { label: "당기순이익", get: (s) => s.netIncome, fmt: (v) => toEok(v), better: "high" },
  { label: "영업이익률", get: (s) => s.opMargin, fmt: (v) => (v !== null ? v.toFixed(1) + "%" : "—"), better: "high" },
  { label: "ROE", get: (s) => s.roe, fmt: (v) => (v !== null ? v.toFixed(1) + "%" : "—"), better: "high" },
  { label: "부채비율", get: (s) => s.debt, fmt: (v) => (v !== null ? v.toFixed(1) + "%" : "—"), better: "low" },
  { label: "PER", get: (s) => s.per, fmt: (v) => (v !== null ? v.toFixed(1) + "배" : "—"), better: "low" },
  { label: "PBR", get: (s) => s.pbr, fmt: (v) => (v !== null ? v.toFixed(1) + "배" : "—"), better: "low" },
];
// 비교 행에서 가장 좋은 칸의 인덱스(동률·단독은 강조 안 함)
function bestIndex(vals: (number | null)[], better: "high" | "low" | null): number {
  if (!better) return -1;
  const valid = vals.map((v, i) => ({ v, i })).filter((x) => x.v !== null) as { v: number; i: number }[];
  if (valid.length < 2) return -1;
  const best = valid.reduce((b, x) => (better === "high" ? (x.v > b.v ? x : b) : x.v < b.v ? x : b));
  // 동률이면 강조 생략
  if (valid.filter((x) => x.v === best.v).length > 1) return -1;
  return best.i;
}

/* ── 원형 점수 게이지 ─────────────────── */
function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  const col = scoreHex(score);
  return (
    <svg width="132" height="132" viewBox="0 0 132 132">
      <circle cx="66" cy="66" r={r} fill="none" strokeWidth="12" className="stroke-zinc-200 dark:stroke-zinc-800" />
      <circle
        cx="66"
        cy="66"
        r={r}
        fill="none"
        stroke={col}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 66 66)"
      />
      <text x="66" y="62" textAnchor="middle" className="fill-zinc-900 dark:fill-zinc-50" fontSize="32" fontWeight="bold">
        {score}
      </text>
      <text x="66" y="84" textAnchor="middle" className="fill-zinc-400" fontSize="12">
        / 100
      </text>
    </svg>
  );
}

/* ── 공시 이벤트 분류(배지) ───────────── */
function classifyDisclosure(name: string): { label: string; cls: string } | null {
  const has = (...ks: string[]) => ks.some((k) => name.includes(k));
  const red = "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  const amber = "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  const green = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  const blue = "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
  const violet = "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300";
  const gray = "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  if (has("합병", "분할", "영업양수", "영업양도", "주식교환", "주식이전")) return { label: "합병·구조개편", cls: red };
  if (has("소송", "분쟁")) return { label: "소송", cls: red };
  if (has("유상증자", "무상증자")) return { label: "증자", cls: amber };
  if (has("전환사채", "신주인수권부사채", "교환사채")) return { label: "사채발행", cls: amber };
  if (has("자기주식")) return { label: "자사주", cls: green };
  if (has("단일판매", "공급계약", "수주")) return { label: "수주·계약", cls: green };
  if (has("배당")) return { label: "배당", cls: green };
  if (has("실적", "잠정", "손익구조", "매출액또는손익")) return { label: "실적", cls: blue };
  if (has("최대주주", "대량보유", "주요주주", "지분")) return { label: "지분변동", cls: violet };
  if (has("사업보고서", "분기보고서", "반기보고서", "감사보고서")) return { label: "정기보고", cls: gray };
  return null;
}

/* ── AI 분석용 프롬프트(복사용) ───────── */
function buildAnalysisPrompt(
  corp: CorpMatch,
  years: YearFinancials[],
  disclosures: Disclosure[],
  news: NewsItem[]
): string {
  const basis = years[0]?.fsDiv === "CFS" ? "연결" : "별도";
  const col = (label: string, fn: (y: YearFinancials) => string) => [label, ...years.map(fn)].join(" | ");
  const table = [
    ["항목", ...years.map((y) => `${y.year}년`)].join(" | "),
    col("매출액", (y) => toEok(y.revenue)),
    col("영업이익", (y) => toEok(y.operatingIncome)),
    col("당기순이익", (y) => toEok(y.netIncome)),
    col("자산총계", (y) => toEok(y.assets)),
    col("부채총계", (y) => toEok(y.liabilities)),
    col("자본총계", (y) => toEok(y.equity)),
    col("영업활동현금흐름", (y) => toEok(y.operatingCashFlow)),
  ].join("\n");
  const disclosureBlock =
    disclosures.length > 0
      ? "\n\n[최근 3개월 주요 공시]\n" +
        disclosures.slice(0, 12).map((d) => `- ${fmtYmd(d.rcept_dt)} ${d.report_nm} (${d.flr_nm})`).join("\n")
      : "";
  const newsBlock =
    news.length > 0 ? "\n\n[최근 3개월 관련 뉴스 헤드라인]\n" + news.slice(0, 10).map((n) => `- ${n.title}`).join("\n") : "";

  return `당신은 신중하고 균형 잡힌 기업 재무 분석가입니다.
아래는 금융감독원 Open DART에서 가져온 '${corp.corp_name}'${
    corp.stock_code ? `(종목코드 ${corp.stock_code})` : ""
}의 최근 ${years.length}개년 ${basis} 기준 재무 데이터와, 최근 공시·뉴스입니다. (재무 단위: 억원)

${table}${disclosureBlock}${newsBlock}

위 자료를 근거로 다음을 한국어로 분석해 주세요.

1. 이 재무 추세가 주가가치에 미칠 영향 — 긍정 요인과 부정 요인을 나눠서.
2. 향후 현금 흐름 및 자금 사정 전망 — 영업활동현금흐름 추이와 부채 수준을 근거로.
3. 최근 공시·뉴스가 시사하는 이벤트 리스크나 변화 — 위 공시/헤드라인을 근거로.
4. 투자자가 주의해야 할 리스크 포인트.

[작성 규칙]
- 모든 추론은 위 자료 중 무엇을 근거로 했는지 함께 밝혀 주세요.
- "반드시", "확실히" 같은 단정 대신 "가능성이 있다" 처럼 신중하게 서술해 주세요.
- 뉴스 헤드라인은 제목만 제공되므로, 본문을 단정하지 말고 "헤드라인상" 같은 표현으로 신중히 다뤄 주세요.
- 이 분석은 참고용이며 투자 권유가 아님을 마지막에 한 줄로 명시해 주세요.`;
}

/* ── 규칙 기반 한눈에 보기 ────────────── */
function quickRead(years: YearFinancials[]): string[] {
  const out: string[] = [];
  const latest = years[0];
  const oldest = years[years.length - 1];
  const revG = growth(latest.revenue, oldest.revenue);
  if (revG !== null)
    out.push(`매출은 ${oldest.year}년 → ${latest.year}년 사이 ${pct(revG)} ${revG >= 0 ? "증가했습니다." : "감소했습니다."}`);
  const opm = ratio(latest.operatingIncome, latest.revenue);
  if (opm !== null)
    out.push(
      `최근 영업이익률은 ${opm.toFixed(1)}%로, ${
        opm >= 10 ? "수익성이 양호한 편입니다." : opm >= 0 ? "수익성이 보통 수준입니다." : "영업적자 상태입니다."
      }`
    );
  const debt = ratio(latest.liabilities, latest.equity);
  if (debt !== null)
    out.push(
      `부채비율은 ${debt.toFixed(1)}%로, ${
        debt < 100 ? "재무 안정성이 높은 편입니다." : debt < 200 ? "보통 수준입니다." : "부채 부담이 다소 높습니다."
      }`
    );
  if (latest.netIncome !== null)
    out.push(
      latest.netIncome >= 0
        ? `${latest.year}년 당기순이익은 흑자(${toEok(latest.netIncome)})입니다.`
        : `${latest.year}년 당기순이익은 적자(${toEok(latest.netIncome)})입니다.`
    );
  if (latest.operatingCashFlow !== null)
    out.push(
      latest.operatingCashFlow >= 0
        ? `영업활동현금흐름은 (+)로, 본업에서 현금이 들어오고 있습니다.`
        : `영업활동현금흐름이 (−)로, 본업의 현금 창출에 주의가 필요합니다.`
    );
  return out;
}

/* ── AI 결과 박스 ─────────────────────── */
function AiBox({
  loading,
  error,
  text,
  label = "AI 요약",
}: {
  loading: boolean;
  error: string | null;
  text?: string;
  label?: string;
}) {
  if (loading)
    return (
      <p className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
        🤖 AI가 분석 중입니다…
      </p>
    );
  if (error)
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        AI 분석을 불러오지 못했습니다: {error}
      </p>
    );
  if (!text) return null;
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/50">
      <span className="mb-1 inline-block rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-800 dark:text-violet-100">
        {label}
      </span>
      <p className="whitespace-pre-line text-sm leading-6 text-violet-900 dark:text-violet-200">{text}</p>
    </div>
  );
}

/* ── 로딩 스켈레톤 ────────────────────── */
function Skeleton() {
  return (
    <div className="mt-8 animate-pulse space-y-4">
      <div className="h-7 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-40 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-52 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-52 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <p className="text-center text-sm text-zinc-400">DART에서 데이터를 불러오는 중입니다… (처음은 10~20초)</p>
    </div>
  );
}

/* ── 섹션 카드 래퍼 ───────────────────── */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200/70 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none">
      <h3 className="mb-5 flex items-center gap-2 text-[15px] font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
        <span className="h-4 w-1 rounded-full bg-blue-500" />
        {title}
      </h3>
      {children}
    </section>
  );
}

const TABS = [
  { id: "fin", label: "재무" },
  { id: "disc", label: "공시·뉴스" },
  { id: "ai", label: "AI 분석" },
  { id: "compare", label: "비교" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [ai, setAi] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("fin");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [rankings, setRankings] = useState<Rankings | null>(null);
  const [rankTab, setRankTab] = useState<"marketCap" | "volume" | "tradeValue">("marketCap");
  const [compInput, setCompInput] = useState("");
  const [competitors, setCompetitors] = useState<ApiResult[]>([]);
  const [compLoading, setCompLoading] = useState(false);

  async function addCompetitor(name: string) {
    const q = name.trim();
    if (!q || compLoading || competitors.length >= 3) return;
    setCompLoading(true);
    try {
      const res = await fetch(`/api/financials?name=${encodeURIComponent(q)}`);
      const data: ApiResult = await res.json();
      const code = data.corp?.stock_code;
      const dup = code === result?.corp?.stock_code || competitors.some((c) => c.corp?.stock_code === code);
      if (data.corp && data.years && data.years.length > 0 && code && !dup) {
        setCompetitors((prev) => [...prev, data]);
        setCompInput("");
      }
    } catch {
      /* 무시 */
    } finally {
      setCompLoading(false);
    }
  }
  function removeCompetitor(code: string) {
    setCompetitors((prev) => prev.filter((c) => c.corp?.stock_code !== code));
  }

  // 첫 화면 순위(시총·거래량·거래대금) 1회 로드
  useEffect(() => {
    fetch("/api/rankings")
      .then((r) => r.json())
      .then((j) => {
        if (!j.error) setRankings(j as Rankings);
      })
      .catch(() => {});
  }, []);

  // 자동완성: 입력 변화 시 디바운스 후 후보 조회
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setSuggestions(json.items ?? []);
      } catch {
        setSuggestions([]);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  async function fetchAnalysis(data: ApiResult) {
    setAi(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          corp: data.corp,
          years: data.years,
          disclosures: data.disclosures ?? [],
          news: data.news ?? [],
          valuation: (() => {
            const v = calcValuation(data.stock ?? null, data.years?.[0]);
            return v ? { per: v.per, pbr: v.pbr } : null;
          })(),
        }),
      });
      const json = await res.json();
      if (json.error) setAiError(json.error);
      else setAi(json as AiAnalysis);
    } catch {
      setAiError("AI 분석 요청에 실패했습니다.");
    } finally {
      setAiLoading(false);
    }
  }

  async function runSearch(rawq: string) {
    const q = rawq.trim();
    if (!q || loading) return;
    setShowSuggest(false);
    setLoading(true);
    setResult(null);
    setAi(null);
    setAiError(null);
    setTab("fin");
    setCompetitors([]);
    setCompInput("");
    try {
      const res = await fetch(`/api/financials?name=${encodeURIComponent(q)}`);
      const data: ApiResult = await res.json();
      setResult(data);
      if (data.corp && data.years && data.years.length > 0) fetchAnalysis(data);
    } catch {
      setResult({ error: "요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." });
    } finally {
      setLoading(false);
    }
  }

  function selectSuggestion(s: Suggestion) {
    setQuery(s.corp_name);
    setShowSuggest(false);
    setSuggestions([]);
    runSearch(s.corp_name);
  }

  async function copyPrompt(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const years = result?.years ?? [];
  const disclosures = result?.disclosures ?? [];
  const news = result?.news ?? [];
  const stock = result?.stock ?? null;
  const latest = years[0];
  const prev = years[1];
  const won = (v: number) => v.toLocaleString("ko-KR") + "원";
  const stockUp = (stock?.latest?.changeRate ?? 0) >= 0;
  const valuation = calcValuation(stock, latest);
  const score = calcScore(years, valuation);
  const compCompanies: CompanySummary[] =
    result?.corp && years.length > 0 ? [summarize(result), ...competitors.map(summarize)] : [];
  const EXAMPLES = ["삼성전자", "카카오", "NAVER", "현대차", "셀트리온"];

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100/50 px-4 py-12 dark:from-black dark:to-zinc-950 sm:px-6">
      <div className="mx-auto max-w-4xl">
        {/* 헤더 */}
        <header className="text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-600/10 px-3 py-1 text-xs font-semibold text-blue-600">
            <span>📊</span> DART 재무 자동분석
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            투자 판단 한눈에 보기
          </h1>
          <p className="mt-3 text-[15px] text-zinc-500 dark:text-zinc-400">
            회사명만 넣으면 재무·비율·공시·뉴스·AI 분석을 한 화면에 모아드립니다.
          </p>
        </header>

        {/* 검색창 + 자동완성 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
          className="relative mt-8 flex gap-2"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggest(true);
              }}
              onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              placeholder="예: 삼성전자 또는 005930"
              className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3.5 text-zinc-900 shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {showSuggest && suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {suggestions.map((s) => (
                  <li key={s.stock_code}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSuggestion(s)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-blue-50 dark:hover:bg-zinc-800"
                    >
                      <span className="text-zinc-800 dark:text-zinc-200">{s.corp_name}</span>
                      <span className="text-xs text-zinc-400">{s.stock_code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-blue-600 px-6 py-3.5 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "조회중…" : "조회"}
          </button>
        </form>

        {/* 예시 칩 */}
        {!result && !loading && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((name) => (
              <button
                key={name}
                onClick={() => {
                  setQuery(name);
                  runSearch(name);
                }}
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:border-blue-500 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400"
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* 첫 화면 순위 위젯 */}
        {!result && !loading && rankings && (
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-200">📈 오늘의 순위</h2>
              <span className="text-xs text-zinc-400">{fmtYmd(rankings.date)} 기준</span>
            </div>
            <div className="rounded-2xl border border-zinc-200/70 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-1 flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
                {RANK_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setRankTab(t.id)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                      rankTab === t.id
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rankings[rankTab].map((r, i) => (
                  <li key={r.code}>
                    <button
                      onClick={() => {
                        setQuery(r.name);
                        runSearch(r.code);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-blue-50 dark:hover:bg-zinc-800"
                    >
                      <span className={`w-5 text-center font-bold ${i < 3 ? "text-blue-600" : "text-zinc-400"}`}>
                        {i + 1}
                      </span>
                      <span className="flex-1 text-left font-medium text-zinc-800 dark:text-zinc-200">{r.name}</span>
                      <span className="tabular-nums text-zinc-500">
                        {RANK_TABS.find((t) => t.id === rankTab)!.fmt(r.value)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {loading && <Skeleton />}

        {result?.error && (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {result.error}
          </div>
        )}

        {result?.corp && years.length > 0 && (
          <div className="mt-8">
            {/* 회사 헤더 */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/70 bg-white px-6 py-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/10 text-lg font-bold text-blue-600">
                  {result.corp.corp_name.slice(0, 1)}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{result.corp.corp_name}</h2>
                  {result.corp.stock_code && (
                    <span className="text-sm text-zinc-500">KRX · {result.corp.stock_code}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {stock?.latest ? (
                  <div className="text-right">
                    <div className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                      {won(stock.latest.close)}
                    </div>
                    <div className={`text-sm font-semibold tabular-nums ${stockUp ? "text-red-500" : "text-blue-500"}`}>
                      {stockUp ? "▲" : "▼"} {Math.abs(stock.latest.change).toLocaleString("ko-KR")} (
                      {stock.latest.changeRate > 0 ? "+" : ""}
                      {stock.latest.changeRate}%)
                    </div>
                  </div>
                ) : null}
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800">
                  {latest?.fsDiv === "CFS" ? "연결 기준" : "별도 기준"} · 단위 억원
                </span>
              </div>
            </div>

            {/* 투자 점수 게이지 (헤드라인) */}
            {score && (
              <div className="mb-5 flex flex-col items-center gap-6 rounded-2xl border border-zinc-200/70 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row">
                <div className="flex shrink-0 flex-col items-center">
                  <ScoreRing score={score.total} />
                  <span
                    className="mt-2 rounded-full px-3 py-1 text-sm font-bold text-white"
                    style={{ backgroundColor: scoreHex(score.total) }}
                  >
                    {score.label}
                  </span>
                </div>
                <div className="w-full flex-1">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">투자 점수</span>
                    <span className="text-xs text-zinc-400">재무·밸류에이션 종합 (참고용)</span>
                  </div>
                  <div className="space-y-2.5">
                    {score.cats.map((c) => (
                      <div key={c.key} className="flex items-center gap-3">
                        <span className="w-16 shrink-0 text-xs text-zinc-500">{c.label}</span>
                        <div className="h-2.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                          {c.score !== null && (
                            <div
                              className="h-2.5 rounded-full transition-all"
                              style={{ width: `${c.score}%`, backgroundColor: scoreHex(c.score) }}
                            />
                          )}
                        </div>
                        <span className="w-7 text-right text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
                          {c.score ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 탭 바 */}
            <div className="mb-5 flex gap-1 rounded-xl border border-zinc-200/70 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
                    tab === t.id
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ───── 재무 탭 ───── */}
            {tab === "fin" && (
              <div className="space-y-6">
                {stock?.latest && stock.series.length > 1 && (
                  <Card title="주가 추이 (최근 6개월)">
                    <StockChart series={stock.series} up={stockUp} />
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-zinc-50 p-3 text-center dark:bg-zinc-800/50">
                        <p className="text-xs text-zinc-500">현재가</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {won(stock.latest.close)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-3 text-center dark:bg-zinc-800/50">
                        <p className="text-xs text-zinc-500">등락률</p>
                        <p className={`mt-0.5 text-sm font-bold tabular-nums ${stockUp ? "text-red-500" : "text-blue-500"}`}>
                          {stock.latest.changeRate > 0 ? "+" : ""}
                          {stock.latest.changeRate}%
                        </p>
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-3 text-center dark:bg-zinc-800/50">
                        <p className="text-xs text-zinc-500">시가총액</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {stock.latest.marketCap ? toEok(stock.latest.marketCap) : "—"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-3 text-center dark:bg-zinc-800/50">
                        <p className="text-xs text-zinc-500">기준일</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {fmtYmd(stock.latest.date)}
                        </p>
                      </div>
                    </div>
                  </Card>
                )}

                {valuation && (valuation.per !== null || valuation.pbr !== null || valuation.loss) && (
                  <Card title={`밸류에이션 · 주가 대비 가치 (${valuation.niYear} 재무 기준)`}>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-zinc-200 p-4 text-center dark:border-zinc-800">
                        <p className="text-xs text-zinc-500">PER</p>
                        <p
                          className={`mt-1 text-xl font-bold tabular-nums ${
                            perTone(valuation.per, valuation.loss) || "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {valuation.loss ? "적자" : valuation.per !== null ? valuation.per.toFixed(1) + "배" : "—"}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">주가 ÷ 순이익</p>
                      </div>
                      <div className="rounded-lg border border-zinc-200 p-4 text-center dark:border-zinc-800">
                        <p className="text-xs text-zinc-500">PBR</p>
                        <p
                          className={`mt-1 text-xl font-bold tabular-nums ${
                            pbrTone(valuation.pbr) || "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {valuation.pbr !== null ? valuation.pbr.toFixed(1) + "배" : "—"}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">주가 ÷ 순자산</p>
                      </div>
                      <div className="rounded-lg border border-zinc-200 p-4 text-center dark:border-zinc-800">
                        <p className="text-xs text-zinc-500">EPS</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {valuation.eps !== null ? Math.round(valuation.eps).toLocaleString("ko-KR") + "원" : "—"}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">주당순이익</p>
                      </div>
                      <div className="rounded-lg border border-zinc-200 p-4 text-center dark:border-zinc-800">
                        <p className="text-xs text-zinc-500">BPS</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {valuation.bps !== null ? Math.round(valuation.bps).toLocaleString("ko-KR") + "원" : "—"}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">주당순자산</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-zinc-400">
                      PER·PBR은 낮을수록 이익·자산 대비 저평가로 볼 수 있으나, 업종·성장성에 따라 적정 수준이 다릅니다. 현재
                      시가총액과 최근 {valuation.niYear}년 사업보고서 실적 기준입니다.
                    </p>
                  </Card>
                )}

                <Card title="핵심 재무 숫자">
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-right text-sm">
                      <thead className="bg-zinc-100 dark:bg-zinc-800/60">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-zinc-700 dark:text-zinc-300">항목</th>
                          {years.map((y) => (
                            <th key={y.year} className="px-4 py-3 font-semibold text-zinc-700 dark:text-zinc-300">
                              {y.year}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {METRIC_ROWS.map((row) => (
                          <tr key={row.key} className="border-t border-zinc-200 dark:border-zinc-800">
                            <td className="px-4 py-3 text-left font-medium text-zinc-800 dark:text-zinc-200">
                              {row.label}
                            </td>
                            {years.map((y) => {
                              const v = y[row.key] as number | null;
                              return (
                                <td
                                  key={y.year}
                                  className={`px-4 py-3 tabular-nums ${v !== null && v < 0 ? "font-medium text-red-500" : DEFAULT_NUM}`}
                                >
                                  {toEok(v)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-6">
                    <FinancialCharts years={years} />
                  </div>
                </Card>

                {prev && (
                  <Card title={`성장성 · ${latest.year} vs ${prev.year} (전년 대비)`}>
                    <div className="grid grid-cols-3 gap-3">
                      {GROWTH_ITEMS.map((item) => {
                        const g = growth(latest[item.key] as number | null, prev[item.key] as number | null);
                        const up = g !== null && g >= 0;
                        return (
                          <div key={item.key} className="rounded-lg border border-zinc-200 p-4 text-center dark:border-zinc-800">
                            <p className="text-xs text-zinc-500">{item.label}</p>
                            <p className={`mt-1 text-lg font-bold ${g === null ? "text-zinc-400" : up ? "text-emerald-600" : "text-red-600"}`}>
                              {pct(g)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}

                <Card title="수익성 · 안정성 비율">
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-right text-sm">
                      <thead className="bg-zinc-100 dark:bg-zinc-800/60">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-zinc-700 dark:text-zinc-300">비율</th>
                          {years.map((y) => (
                            <th key={y.year} className="px-4 py-3 font-semibold text-zinc-700 dark:text-zinc-300">
                              {y.year}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {RATIO_ROWS.map((row) => (
                          <tr key={row.label} className="border-t border-zinc-200 dark:border-zinc-800">
                            <td className="px-4 py-3 text-left">
                              <span className="font-medium text-zinc-800 dark:text-zinc-200">{row.label}</span>
                              <span className="ml-2 text-xs text-zinc-400">{row.desc}</span>
                            </td>
                            {years.map((y) => {
                              const v = row.calc(y);
                              const tone = v === null ? "" : ratioTone(row.label, v);
                              return (
                                <td
                                  key={y.year}
                                  className={`px-4 py-3 tabular-nums font-medium ${tone || DEFAULT_NUM}`}
                                >
                                  {v === null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "%"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {/* ───── 공시·뉴스 탭 ───── */}
            {tab === "disc" && (
              <div className="space-y-6">
                <Card title="주요 공시 (최근 3개월)">
                  {disclosures.length === 0 ? (
                    <p className="text-sm text-zinc-500">최근 3개월 내 공시를 찾지 못했습니다.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                      {disclosures.map((d) => {
                        const badge = classifyDisclosure(d.report_nm);
                        return (
                          <li key={d.rcept_no} className="flex items-center gap-3 px-4 py-3 text-sm">
                            <span className="w-20 shrink-0 text-xs text-zinc-500">{fmtYmd(d.rcept_dt)}</span>
                            {badge && (
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                                {badge.label}
                              </span>
                            )}
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 text-zinc-800 hover:text-blue-600 hover:underline dark:text-zinc-200"
                            >
                              {d.report_nm}
                            </a>
                            <span className="hidden shrink-0 text-xs text-zinc-400 sm:block">{d.flr_nm}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="mt-3">
                    <AiBox loading={aiLoading} error={aiError} text={ai?.disclosureSummary} label="AI 공시 요약" />
                  </div>
                </Card>

                <Card title="최근 뉴스 (3개월)">
                  {news.length === 0 ? (
                    <p className="text-sm text-zinc-500">관련 뉴스를 찾지 못했습니다.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                      {news.map((n, i) => (
                        <li key={i} className="px-4 py-3 text-sm">
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-800 hover:text-blue-600 hover:underline dark:text-zinc-200"
                          >
                            {n.title}
                          </a>
                          <div className="mt-1 flex gap-2 text-xs text-zinc-400">
                            {n.source && <span>{n.source}</span>}
                            {n.pubDate && <span>· {fmtNewsDate(n.pubDate)}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3">
                    <AiBox loading={aiLoading} error={aiError} text={ai?.newsSummary} label="AI 뉴스 요약" />
                  </div>
                </Card>
              </div>
            )}

            {/* ───── AI 분석 탭 ───── */}
            {tab === "ai" && (
              <div className="space-y-6">
                <Card title="한눈에 보기 & 주가 영향">
                  <ul className="space-y-2">
                    {quickRead(years).map((line, i) => (
                      <li key={i} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <span className="text-blue-500">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 space-y-3">
                    <AiBox loading={aiLoading} error={aiError} text={ai?.overall} label="AI 종합" />
                    {ai?.stockImpact && <AiBox loading={false} error={null} text={ai.stockImpact} label="AI 주가 영향 검토" />}
                  </div>
                </Card>

                <Card title="AI 심층 분석 프롬프트 (복사용)">
                  <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                    아래 프롬프트를 복사해{" "}
                    <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 underline">
                      Claude
                    </a>{" "}
                    나{" "}
                    <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 underline">
                      ChatGPT
                    </a>{" "}
                    에 붙여넣으면 더 깊은 분석도 받을 수 있어요.
                  </p>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                      <span className="text-xs text-zinc-500">분석 요청 프롬프트</span>
                      <button
                        onClick={() => copyPrompt(buildAnalysisPrompt(result.corp!, years, disclosures, news))}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                      >
                        {copied ? "✓ 복사됨!" : "📋 프롬프트 복사"}
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={buildAnalysisPrompt(result.corp, years, disclosures, news)}
                      className="h-48 w-full resize-none bg-transparent p-4 font-mono text-xs text-zinc-700 outline-none dark:text-zinc-300"
                    />
                  </div>
                </Card>
              </div>
            )}

            {/* ───── 비교 탭 ───── */}
            {tab === "compare" && (
              <div className="space-y-6">
                <Card title="경쟁사 비교">
                  <p className="mb-3 text-sm text-zinc-500">
                    비교할 회사를 최대 3개까지 추가하세요. {result.corp.corp_name}와 핵심 지표·밸류에이션·투자점수를
                    나란히 비교합니다.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addCompetitor(compInput);
                    }}
                    className="flex gap-2"
                  >
                    <input
                      value={compInput}
                      onChange={(e) => setCompInput(e.target.value)}
                      placeholder="예: SK하이닉스 또는 000660"
                      disabled={competitors.length >= 3}
                      className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    />
                    <button
                      type="submit"
                      disabled={compLoading || competitors.length >= 3}
                      className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      {compLoading ? "추가중…" : "추가"}
                    </button>
                  </form>
                  {competitors.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {competitors.map((c) => (
                        <span
                          key={c.corp!.stock_code}
                          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          {c.corp!.corp_name}
                          <button
                            onClick={() => removeCompetitor(c.corp!.stock_code)}
                            className="text-zinc-400 hover:text-red-500"
                            aria-label="삭제"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-5 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-right text-sm">
                      <thead className="bg-zinc-100 dark:bg-zinc-800/60">
                        <tr>
                          <th className="px-3 py-3 text-left font-semibold text-zinc-700 dark:text-zinc-300">항목</th>
                          {compCompanies.map((c, i) => (
                            <th key={c.code} className="px-3 py-3 font-semibold text-zinc-700 dark:text-zinc-300">
                              {c.name}
                              {i === 0 && <span className="ml-1 text-[10px] font-normal text-blue-600">기준</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {COMPARE_ROWS.map((row) => {
                          const vals = compCompanies.map(row.get);
                          const bi = bestIndex(vals, row.better);
                          return (
                            <tr key={row.label} className="border-t border-zinc-200 dark:border-zinc-800">
                              <td className="px-3 py-3 text-left font-medium text-zinc-800 dark:text-zinc-200">
                                {row.label}
                              </td>
                              {compCompanies.map((c, i) => (
                                <td
                                  key={c.code}
                                  className={`px-3 py-3 tabular-nums ${
                                    i === bi ? "font-bold text-emerald-600" : DEFAULT_NUM
                                  }`}
                                >
                                  {row.fmt(vals[i])}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {competitors.length === 0 && (
                    <p className="mt-3 text-xs text-zinc-400">
                      아직 비교 대상이 없어요. 위에서 회사를 추가하면 나란히 비교됩니다. (초록색 = 그 항목 1위)
                    </p>
                  )}
                </Card>
              </div>
            )}

            <p className="mt-6 text-center text-xs text-zinc-400">
              출처: 금융감독원 Open DART · 구글 뉴스. 본 화면은 참고용이며 투자 권유가 아닙니다.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
