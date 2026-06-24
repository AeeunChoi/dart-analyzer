"use client";

import { useState } from "react";

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

type ApiResult = {
  corp?: CorpMatch;
  years?: YearFinancials[];
  error?: string;
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

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/financials?name=${encodeURIComponent(q)}`);
      const data: ApiResult = await res.json();
      setResult(data);
    } catch {
      setResult({ error: "요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." });
    } finally {
      setLoading(false);
    }
  }

  const years = result?.years ?? [];
  // 매출 추이 막대그래프용 최대값
  const maxRevenue = Math.max(...years.map((y) => y.revenue ?? 0), 1);
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

            {/* 4. 매출 추이 막대그래프 */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-zinc-500">④ 매출액 추이</h3>
              <div className="space-y-2">
                {[...years].reverse().map((y) => (
                  <div key={y.year} className="flex items-center gap-3">
                    <span className="w-12 text-xs text-zinc-500">{y.year}</span>
                    <div className="h-6 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="flex h-6 items-center justify-end rounded bg-blue-500 px-2 text-xs font-medium text-white"
                        style={{ width: `${Math.max(((y.revenue ?? 0) / maxRevenue) * 100, 8)}%` }}
                      >
                        {toEok(y.revenue)}
                      </div>
                    </div>
                  </div>
                ))}
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
