// 구글 Gemini(무료 등급)로 공시·뉴스·재무를 분석한다.
const GEMINI_MODEL = "gemini-2.5-flash";

export type AiAnalysis = {
  disclosureSummary: string; // ⑤ 공시 요약 (2~3문장)
  newsSummary: string; // ⑥ 뉴스 요약 (2~3문장)
  stockImpact: string; // 주가 영향 검토
  overall: string; // 종합 한눈에 보기
};

type Year = {
  year: number;
  fsDiv: string;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
  operatingCashFlow: number | null;
};
type Disc = { report_nm: string; rcept_dt: string; flr_nm: string };
type News = { title: string };

export type AnalyzePayload = {
  corp: { corp_name: string; stock_code: string };
  years: Year[];
  disclosures: Disc[];
  news: News[];
};

function eok(v: number | null): string {
  if (v === null) return "—";
  return (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "억";
}

function buildPrompt(p: AnalyzePayload): string {
  const { corp, years, disclosures, news } = p;
  const basis = years[0]?.fsDiv === "CFS" ? "연결" : "별도";
  const row = (label: string, fn: (y: Year) => string) =>
    [label, ...years.map(fn)].join(" | ");

  const table = [
    ["항목", ...years.map((y) => `${y.year}년`)].join(" | "),
    row("매출액", (y) => eok(y.revenue)),
    row("영업이익", (y) => eok(y.operatingIncome)),
    row("당기순이익", (y) => eok(y.netIncome)),
    row("부채총계", (y) => eok(y.liabilities)),
    row("자본총계", (y) => eok(y.equity)),
    row("영업활동현금흐름", (y) => eok(y.operatingCashFlow)),
  ].join("\n");

  const discText =
    disclosures.length > 0
      ? disclosures.slice(0, 12).map((d) => `- ${d.rcept_dt} ${d.report_nm} (${d.flr_nm})`).join("\n")
      : "(최근 공시 없음)";
  const newsText =
    news.length > 0 ? news.slice(0, 10).map((n) => `- ${n.title}`).join("\n") : "(관련 뉴스 없음)";

  return `당신은 신중하고 균형 잡힌 한국 기업 재무 분석가입니다.
대상: '${corp.corp_name}'${corp.stock_code ? `(종목코드 ${corp.stock_code})` : ""}
아래는 최근 ${years.length}개년 ${basis} 재무(단위: 억원), 최근 3개월 공시, 최근 3개월 뉴스 헤드라인입니다.

[재무]
${table}

[최근 공시]
${discText}

[최근 뉴스 헤드라인]
${newsText}

위 자료만 근거로 다음 4개 항목을 한국어로 작성하세요. 각 항목은 자연스러운 문장으로.
- disclosureSummary: 최근 공시들이 의미하는 핵심을 2~3문장으로. (증자·CB·자사주·합병·실적·소송 등 이벤트가 있으면 짚을 것)
- newsSummary: 최근 뉴스 헤드라인의 주제와 논조를 2~3문장으로.
- stockImpact: 위 재무·공시·뉴스가 주가에 미칠 수 있는 영향을 긍정 요인과 부정 요인으로 나눠 신중하게 검토 (4~6문장).
- overall: 투자자가 한눈에 볼 종합 코멘트 3~4문장.

[규칙]
- 자료에 없는 사실은 지어내지 말 것. 뉴스는 헤드라인만 주어졌으므로 "헤드라인상" 같이 신중히 표현.
- "반드시/확실히" 같은 단정 대신 "가능성"으로 서술. 투자 권유가 아님을 전제.
- 반드시 지정된 JSON 형식으로만 답할 것.`;
}

export async function analyzeCompany(payload: AnalyzePayload): Promise<AiAnalysis> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY가 없습니다. .env.local(로컬) 또는 Vercel 환경변수를 확인하세요.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const body = {
    contents: [{ parts: [{ text: buildPrompt(payload) }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          disclosureSummary: { type: "string" },
          newsSummary: { type: "string" },
          stockImpact: { type: "string" },
          overall: { type: "string" },
        },
        required: ["disclosureSummary", "newsSummary", "stockImpact", "overall"],
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini 호출 실패 (HTTP ${res.status}): ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 응답이 비어 있습니다.");

  try {
    return JSON.parse(text) as AiAnalysis;
  } catch {
    throw new Error("Gemini 응답(JSON) 파싱에 실패했습니다.");
  }
}
