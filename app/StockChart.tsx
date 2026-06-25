"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; close: number };

// YYYYMMDD → M/D
function shortDate(d: string): string {
  if (!/^\d{8}$/.test(d)) return d;
  return `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}`;
}

export default function StockChart({ series, up }: { series: Point[]; up: boolean }) {
  const data = series.map((p) => ({ date: shortDate(p.date), close: p.close }));
  const color = up ? "#ef4444" : "#3b82f6"; // 한국 증권 관습: 상승 빨강 / 하락 파랑

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
          <YAxis
            tick={{ fontSize: 11 }}
            width={52}
            domain={["auto", "auto"]}
            tickFormatter={(v) => Number(v).toLocaleString("ko-KR")}
          />
          <Tooltip
            formatter={(v: unknown) => [Number(v).toLocaleString("ko-KR") + "원", "종가"]}
            labelStyle={{ fontSize: 12 }}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Area type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill="url(#stockFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
