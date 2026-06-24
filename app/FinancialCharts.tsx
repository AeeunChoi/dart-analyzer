"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Year = {
  year: number;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
};

// 원 → 억 (정수)
function eokNum(v: number | null): number | null {
  return v === null ? null : Math.round(v / 1e8);
}

// 축 라벨: 1만억(=1조) 이상이면 "N조"로 축약
function axisFmt(v: number): string {
  if (Math.abs(v) >= 10000) return Math.round(v / 10000) + "조";
  return `${v}`;
}
function tipFmt(v: unknown): string {
  return Number(v as number).toLocaleString("ko-KR") + "억";
}

export default function FinancialCharts({ years }: { years: Year[] }) {
  // years는 최신→과거 순. 차트는 과거→최신이 자연스럽다.
  const data = [...years].reverse().map((y) => ({
    year: `${y.year}`,
    매출액: eokNum(y.revenue),
    영업이익: eokNum(y.operatingIncome),
    당기순이익: eokNum(y.netIncome),
    자산총계: eokNum(y.assets),
    부채총계: eokNum(y.liabilities),
    자본총계: eokNum(y.equity),
  }));

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-medium text-zinc-500">손익 (매출·영업이익·순이익)</p>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={axisFmt} />
              <Tooltip formatter={tipFmt} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="매출액" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="영업이익" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="당기순이익" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-500">재무상태 (자산·부채·자본)</p>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={axisFmt} />
              <Tooltip formatter={tipFmt} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="자산총계" fill="#60a5fa" radius={[3, 3, 0, 0]} />
              <Bar dataKey="부채총계" fill="#f87171" radius={[3, 3, 0, 0]} />
              <Bar dataKey="자본총계" fill="#34d399" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
