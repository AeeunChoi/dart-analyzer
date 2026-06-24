"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

// 차트는 SSR 충돌을 피하려 클라이언트에서만 로드
const FinancialCharts = dynamic(() => import("./FinancialCharts"), {
  ssr: false,
  loading: () => <p className="py-8 text-center text-sm text-zinc-400">차트 로딩 중…</p>,
});

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

type CorpMatch = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  listed: boolean;
};

type Disclosure = {
  report_nm: string;
  rcept_dt: string;
  flr_nm: string;
  rcept_no: string;
  url: string;
};

type NewsItem = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
};

type ApiResult = {
  corp?: CorpMatch;
  years?: YearFinancials[];
  disclosures?: Disclosure[];
  news?: NewsItem[];
  error?: string;
};

type AiAnalysis = {
  disclosureSummary: string;
  newsSummary: string;
  stockImpact: string;
  overall: string;
};

/* ── 숫자 포맷 ───────────────────────────── */
// 원 단위 큰 숫자를 "억"으로 변환
function toEok(value: number | null): string {
  if (value === null) return "—";
  return (value / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "억";
}
function pct(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "%";
}

/* ── 비율 계산 ───────────────────────────── */
function ratio(numer: number | null, denom: number | null): number | null {
  if (numer === null || denom === null || denom === 0) return null;
  return (numer / denom) * 100;
}
function growth(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
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

// 수익성·안정성 비율 (높을수록 좋음 good:"high" / 낮을수록 좋음 good:"low")
const RATIO_ROWS: {
  label: string;
  desc: string;
  good: "high" | "low";
  calc: (y: YearFinancials) => number | null;
}[] = [
  { label: "영업이익률", desc: "매출 대비 영업이익", good: "high", calc: (y) => ratio(y.operatingIncome, y.revenue) },
  { label: "순이익률", desc: "매출 대비 당기순이익", good: "high", calc: (y) => ratio(y.netIncome, y.revenue) },
  { label: "ROE", desc: "자본 대비 순이익(자기자본이익률)", good: "high", calc: (y) => ratio(y.netIncome, y.equity) },
  { label: "부채비율", desc: "자본 대비 부채(낮을수록 안정)", good: "low", calc: (y) => ratio(y.liabilities, y.equity) },
  { label: "자기자본비율", desc: "자산 중 자기자본 비중", good: "high", calc: (y) => ratio(y.equity, y.assets) },
];

// 성장성: 전년 대비 증가율 (years는 최신→과거 순)
const GROWTH_ITEMS: { key: keyof YearFinancials; label: string }[] = [
  { key: "revenue", label: "매출액" },
  { key: "operatingIncome", label: "영업이익" },
  { key: "netIncome", label: "당기순이익" },
];

/* ── 날짜 포맷 ── */
function fmtYmd(s: string): string {
  // YYYYMMDD → YYYY.MM.DD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
  return s;
}
function fmtNewsDate(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR");
}

/* ── ⑤ AI 분석용 프롬프트 자동 생성 (API 비용 없이 복사해서 사용) ── */
function buildAnalysisPrompt(
  corp: CorpMatch,
  years: YearFinancials[],
  disclosures: Disclosure[],
  news: NewsItem[]
): string {
  const basis = years[0]?.fsDiv === "CFS" ? "연결" : "별도";
  const col = (label: string, fn: (y: YearFinancials) => string) =>
    [label, ...years.map(fn)].join(" | ");

  const table = [
    ["항목", ...years.map((y) => `${y.year}년`)].join(" | "),
    col("매출액", (y) => toEok(y.revenue)),
    col("영업이익", (y) => toEok(y.operatingIncome)),
    col("당기순이익", (y) => toEok(y.netIncome)),
    col("자산총계", (y) => toEok(y.assets)),
    col("부채총계", (y) => toEok(y.liabilities)),
    col("자본총계", (y) => toEok(y.equity)),
    col("영업활동현금흐름", (y) => toEok(y.operatingCashFlow)),
    col("영업이익률", (y) => {
      const r = ratio(y.operatingIncome, y.revenue);
      return r === null ? "—" : r.toFixed(1) + "%";
    }),
    col("부채비율", (y) => {
      const r = ratio(y.liabilities, y.equity);
      return r === null ? "—" : r.toFixed(1) + "%";
    }),
    col("ROE", (y) => {
      const r = ratio(y.netIncome, y.equity);
      return r === null ? "—" : r.toFixed(1) + "%";
    }),
  ].join("\n");

  const disclosureBlock =
    disclosures.length > 0
      ? "\n\n[최근 3개월 주요 공시]\n" +
        disclosures.slice(0, 12).map((d) => `- ${fmtYmd(d.rcept_dt)} ${d.report_nm} (${d.flr_nm})`).join("\n")
      : "";

  const newsBlock =
    news.length > 0
      ? "\n\n[최근 3개월 관련 뉴스 헤드라인]\n" +
        news.slice(0, 10).map((n) => `- ${n.title}`).join("\n")
      : "";

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

/* ── ⚡ 규칙 기반 한눈에 보기 (AI 없이 즉석 코멘트) ── */
function quickRead(years: YearFinancials[]): string[] {
  const out: string[] = [];
  const latest = years[0];
  const oldest = years[years.length - 1];

  const revG = growth(latest.revenue, oldest.revenue);
  if (revG !== null) {
    out.push(
      `매출은 ${oldest.year}년 → ${latest.year}년 사이 ${pct(revG)} ${
        revG >= 0 ? "증가했습니다." : "감소했습니다."
      }`
    );
  }

  const opm = ratio(latest.operatingIncome, latest.revenue);
  if (opm !== null) {
    out.push(
      `최근 영업이익률은 ${opm.toFixed(1)}%로, ${
        opm >= 10 ? "수익성이 양호한 편입니다." : opm >= 0 ? "수익성이 보통 수준입니다." : "영업적자 상태입니다."
      }`
    );
  }

  const debt = ratio(latest.liabilities, latest.equity);
  if (debt !== null) {
    out.push(
      `부채비율은 ${debt.toFixed(1)}%로, ${
        debt < 100 ? "재무 안정성이 높은 편입니다." : debt < 200 ? "보통 수준입니다." : "부채 부담이 다소 높습니다."
      }`
    );
  }

  if (latest.netIncome !== null) {
    out.push(
      latest.netIncome >= 0
        ? `${latest.year}년 당기순이익은 흑자(${toEok(latest.netIncome)})입니다.`
        : `${latest.year}년 당기순이익은 적자(${toEok(latest.netIncome)})입니다.`
    );
  }

  if (latest.operatingCashFlow !== null) {
    out.push(
      latest.operatingCashFlow >= 0
        ? `영업활동현금흐름은 (+)로, 본업에서 현금이 들어오고 있습니다.`
        : `영업활동현금흐름이 (−)로, 본업의 현금 창출에 주의가 필요합니다.`
    );
  }

  return out;
}

// AI(Gemini) 분석 결과 박스 — 로딩/에러/내용 상태를 함께 처리
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
  if (loading) {
    return (
      <p className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
        🤖 AI가 분석 중입니다…
      </p>
    );
  }
  if (error) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        AI 분석을 불러오지 못했습니다: {error}
      </p>
    );
  }
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

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [ai, setAi] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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

  async function copyPrompt(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setResult(null);
    setAi(null);
    setAiError(null);
    try {
      const res = await fetch(`/api/financials?name=${encodeURIComponent(q)}`);
      const data: ApiResult = await res.json();
      setResult(data);
      // 재무 조회에 성공하면 AI 분석을 이어서 자동 실행
      if (data.corp && data.years && data.years.length > 0) {
        fetchAnalysis(data);
      }
    } catch {
      setResult({ error: "요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." });
    } finally {
      setLoading(false);
    }
  }

  const years = result?.years ?? [];
  const disclosures = result?.disclosures ?? [];
  const news = result?.news ?? [];
  // 성장성: 최신연도(years[0]) vs 직전연도(years[1])
  const latest = years[0];
  const prev = years[1];

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="mx-auto max-w-3xl">
        <header className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            DART 재무 자동분석
          </p>
          <h1 className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            기업 재무제표 조회 &amp; 비율 분석
          </h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            회사명 또는 6자리 종목코드를 입력하면 최근 3개년 재무 숫자와 핵심 비율을 보여드립니다.
          </p>
        </header>

        <form onSubmit={handleSearch} className="mt-8 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 삼성전자 또는 005930"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "조회중…" : "조회"}
          </button>
        </form>

        {loading && (
          <p className="mt-8 text-center text-zinc-500">
            DART에서 데이터를 불러오는 중입니다… (처음 조회는 10~20초 걸릴 수 있어요)
          </p>
        )}

        {result?.error && (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {result.error}
          </div>
        )}

        {result?.corp && years.length > 0 && (
          <div className="mt-8 space-y-10">
            {/* 회사 헤더 */}
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                {result.corp.corp_name}
                {result.corp.stock_code && (
                  <span className="ml-2 text-sm font-normal text-zinc-500">
                    ({result.corp.stock_code})
                  </span>
                )}
              </h2>
              <span className="text-xs text-zinc-500">
                {years[0]?.fsDiv === "CFS" ? "연결 기준" : "별도 기준"} · 단위: 억원
              </span>
            </div>

            {/* 1. 원본 재무 숫자 */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-zinc-500">① 핵심 재무 숫자</h3>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-right text-sm">
                  <thead className="bg-zinc-100 dark:bg-zinc-900">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-700 dark:text-zinc-300">
                        항목
                      </th>
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
                        {years.map((y) => (
                          <td key={y.year} className="px-4 py-3 tabular-nums text-zinc-700 dark:text-zinc-300">
                            {toEok(y[row.key] as number | null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6">
                <FinancialCharts years={years} />
              </div>
            </section>

            {/* 2. 성장성 (전년 대비) */}
            {prev && (
              <section>
                <h3 className="mb-3 text-sm font-semibold text-zinc-500">
                  ② 성장성 · {latest.year} vs {prev.year} (전년 대비)
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  {GROWTH_ITEMS.map((item) => {
                    const g = growth(latest[item.key] as number | null, prev[item.key] as number | null);
                    const up = g !== null && g >= 0;
                    return (
                      <div
                        key={item.key}
                        className="rounded-lg border border-zinc-200 p-4 text-center dark:border-zinc-800"
                      >
                        <p className="text-xs text-zinc-500">{item.label}</p>
                        <p
                          className={`mt-1 text-lg font-bold ${
                            g === null
                              ? "text-zinc-400"
                              : up
                              ? "text-emerald-600"
                              : "text-red-600"
                          }`}
                        >
                          {pct(g)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 3. 수익성·안정성 비율 */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-zinc-500">③ 수익성 · 안정성 비율</h3>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-right text-sm">
                  <thead className="bg-zinc-100 dark:bg-zinc-900">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-700 dark:text-zinc-300">
                        비율
                      </th>
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
                        {years.map((y) => (
                          <td key={y.year} className="px-4 py-3 tabular-nums text-zinc-700 dark:text-zinc-300">
                            {row.calc(y) === null
                              ? "—"
                              : row.calc(y)!.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "%"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4. 주요 공시 (최근 3개월) */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-zinc-500">④ 주요 공시 (최근 3개월)</h3>
              {disclosures.length === 0 ? (
                <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
                  최근 3개월 내 공시를 찾지 못했습니다.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {disclosures.map((d) => (
                    <li key={d.rcept_no} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <span className="w-24 shrink-0 text-xs text-zinc-500">{fmtYmd(d.rcept_dt)}</span>
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
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <AiBox loading={aiLoading} error={aiError} text={ai?.disclosureSummary} label="AI 공시 요약" />
              </div>
            </section>

            {/* 6. 최근 뉴스 (3개월) */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-zinc-500">⑤ 최근 뉴스 (3개월)</h3>
              {news.length === 0 ? (
                <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
                  관련 뉴스를 찾지 못했습니다.
                </p>
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
            </section>

            {/* 7. 한눈에 보기 (규칙 기반, 무료) */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-zinc-500">⑥ 한눈에 보기 (자동 요약)</h3>
              <ul className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                {quickRead(years).map((line, i) => (
                  <li key={i} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <span className="text-blue-500">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 space-y-3">
                <AiBox loading={aiLoading} error={aiError} text={ai?.overall} label="AI 종합" />
                {ai?.stockImpact && (
                  <AiBox loading={false} error={null} text={ai.stockImpact} label="AI 주가 영향 검토" />
                )}
              </div>
            </section>

            {/* 6. AI 분석 프롬프트 (API 비용 없이 복사해서 사용) */}
            <section>
              <h3 className="mb-1 text-sm font-semibold text-zinc-500">⑦ AI 심층 분석 프롬프트 (복사용)</h3>
              <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                아래 버튼으로 분석 프롬프트를 복사한 뒤,{" "}
                <a
                  href="https://claude.ai/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-600 underline"
                >
                  Claude
                </a>{" "}
                나{" "}
                <a
                  href="https://chatgpt.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-600 underline"
                >
                  ChatGPT
                </a>{" "}
                채팅창에 붙여넣으면 심층 분석글이 나옵니다. (별도 API 키·비용 불필요)
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
            </section>

            <p className="text-xs text-zinc-400">
              출처: 금융감독원 Open DART 사업보고서. 본 화면은 참고용이며 투자 권유가 아닙니다.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
