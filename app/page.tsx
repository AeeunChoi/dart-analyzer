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

// 원(￦) 단위 큰 숫자를 "억원"으로 읽기 쉽게 변환
function toEok(value: number | null): string {
  if (value === null) return "—";
  const eok = value / 1e8;
  return eok.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "억";
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

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="mx-auto max-w-3xl">
        <header className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            DART 재무 자동분석
          </p>
          <h1 className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            기업 재무제표 조회
          </h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            회사명 또는 6자리 종목코드를 입력하면 최근 3개년 핵심 재무 숫자를 보여드립니다.
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
          <section className="mt-8">
            <div className="mb-3 flex items-baseline justify-between">
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

            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-right text-sm">
                <thead className="bg-zinc-100 dark:bg-zinc-900">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-700 dark:text-zinc-300">
                      항목
                    </th>
                    {years.map((y) => (
                      <th
                        key={y.year}
                        className="px-4 py-3 font-semibold text-zinc-700 dark:text-zinc-300"
                      >
                        {y.year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row) => (
                    <tr
                      key={row.key}
                      className="border-t border-zinc-200 dark:border-zinc-800"
                    >
                      <td className="px-4 py-3 text-left font-medium text-zinc-800 dark:text-zinc-200">
                        {row.label}
                      </td>
                      {years.map((y) => (
                        <td
                          key={y.year}
                          className="px-4 py-3 tabular-nums text-zinc-700 dark:text-zinc-300"
                        >
                          {toEok(y[row.key] as number | null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-zinc-400">
              출처: 금융감독원 Open DART 사업보고서. 본 화면은 참고용이며 투자 권유가 아닙니다.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
