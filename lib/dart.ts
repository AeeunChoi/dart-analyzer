import corpMapRaw from "./corp-map.json";

const DART_BASE = "https://opendart.fss.or.kr/api";

function getKey(): string {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    throw new Error(
      "OPENDART_API_KEY가 없습니다. .env.local(로컬) 또는 Vercel 환경변수를 확인하세요."
    );
  }
  return key;
}

/* ──────────────────────────────────────────────
 * 1) 회사명 → corp_code(8자리) 매핑
 *    빌드 시 미리 만들어둔 상장사 목록(lib/corp-map.json)을 사용한다.
 *    (목록 생성/갱신: node scripts/build-corp-map.mjs)
 *    → 조회 때마다 20MB 파일을 받지 않으므로 빠르고 시간 초과가 없다.
 * ────────────────────────────────────────────── */
type CorpEntry = { corp_code: string; corp_name: string; stock_code: string };

const CORP_LIST: CorpEntry[] = (corpMapRaw as { c: string; n: string; s: string }[]).map(
  (e) => ({ corp_code: e.c, corp_name: e.n, stock_code: e.s })
);

export type CorpMatch = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  listed: boolean;
};

function toMatch(e: CorpEntry): CorpMatch {
  return {
    corp_code: e.corp_code,
    corp_name: e.corp_name,
    stock_code: e.stock_code,
    listed: !!e.stock_code,
  };
}

/** 회사명 / 6자리 종목코드 / 8자리 고유번호 무엇이 들어와도 회사를 찾아준다. */
export function findCorp(input: string): CorpMatch | null {
  const q = input.trim();
  if (!q) return null;
  const list = CORP_LIST;

  if (/^\d{6}$/.test(q)) {
    const byStock = list.find((e) => e.stock_code === q);
    if (byStock) return toMatch(byStock);
  }
  if (/^\d{8}$/.test(q)) {
    const byCode = list.find((e) => e.corp_code === q);
    if (byCode) return toMatch(byCode);
  }

  // 회사명: 상장사(종목코드 보유) 우선 → 정확히 일치 → 부분 일치
  const listed = list.filter((e) => e.stock_code);
  const exactListed = listed.find((e) => e.corp_name === q);
  if (exactListed) return toMatch(exactListed);
  const partialListed = listed.find((e) => e.corp_name.includes(q));
  if (partialListed) return toMatch(partialListed);

  // 비상장 포함 재시도
  const exactAny = list.find((e) => e.corp_name === q);
  if (exactAny) return toMatch(exactAny);

  return null;
}

/* ──────────────────────────────────────────────
 * 2) 재무제표 조회 (단일회사 전체 재무제표 fnlttSinglAcntAll)
 *    한 번 호출로 재무상태표(BS)·손익(IS/CIS)·현금흐름(CF)이 모두 온다.
 * ────────────────────────────────────────────── */
export type YearFinancials = {
  year: number;
  fsDiv: "CFS" | "OFS"; // CFS=연결, OFS=별도
  revenue: number | null; // 매출액
  operatingIncome: number | null; // 영업이익
  netIncome: number | null; // 당기순이익
  assets: number | null; // 자산총계
  liabilities: number | null; // 부채총계
  equity: number | null; // 자본총계
  operatingCashFlow: number | null; // 영업활동현금흐름
};

// 표준 계정 ID(account_id)로 먼저 찾고, 없으면 계정명(account_nm)으로 보조 매칭
const METRICS = {
  revenue: {
    ids: ["ifrs-full_Revenue", "ifrs_Revenue", "dart_OperatingRevenue"],
    names: ["매출액", "수익(매출액)", "영업수익"],
    sj: ["IS", "CIS"],
  },
  operatingIncome: {
    ids: ["dart_OperatingIncomeLoss", "dart_OperatingIncome"],
    names: ["영업이익", "영업이익(손실)"],
    sj: ["IS", "CIS"],
  },
  netIncome: {
    ids: ["ifrs-full_ProfitLoss", "ifrs_ProfitLoss"],
    names: ["당기순이익", "당기순이익(손실)", "당기순이익(손실)"],
    sj: ["IS", "CIS"],
  },
  assets: {
    ids: ["ifrs-full_Assets", "ifrs_Assets"],
    names: ["자산총계"],
    sj: ["BS"],
  },
  liabilities: {
    ids: ["ifrs-full_Liabilities", "ifrs_Liabilities"],
    names: ["부채총계"],
    sj: ["BS"],
  },
  equity: {
    ids: ["ifrs-full_Equity", "ifrs_Equity"],
    names: ["자본총계"],
    sj: ["BS"],
  },
  operatingCashFlow: {
    ids: [
      "ifrs-full_CashFlowsFromUsedInOperatingActivities",
      "ifrs_CashFlowsFromUsedInOperatingActivities",
    ],
    names: ["영업활동현금흐름", "영업활동으로 인한 현금흐름", "영업활동으로 인한 현금흐름(간접법)"],
    sj: ["CF"],
  },
} as const;

type DartRow = {
  sj_div?: string;
  account_id?: string;
  account_nm?: string;
  thstrm_amount?: string;
};

function parseAmount(s: string | undefined): number | null {
  if (!s) return null;
  let str = s.replace(/,/g, "").trim();
  if (str === "" || str === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(str)) {
    neg = true;
    str = str.slice(1, -1);
  }
  const n = Number(str);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

function extractAmount(
  rows: DartRow[],
  ids: readonly string[],
  names: readonly string[],
  sjDivs: readonly string[]
): number | null {
  // 1순위: 계정 ID 일치
  for (const row of rows) {
    if (sjDivs.length && !sjDivs.includes((row.sj_div ?? "").trim())) continue;
    if (ids.includes((row.account_id ?? "").trim())) {
      const v = parseAmount(row.thstrm_amount);
      if (v !== null) return v;
    }
  }
  // 2순위: 계정명 일치
  for (const row of rows) {
    if (sjDivs.length && !sjDivs.includes((row.sj_div ?? "").trim())) continue;
    if (names.includes((row.account_nm ?? "").trim())) {
      const v = parseAmount(row.thstrm_amount);
      if (v !== null) return v;
    }
  }
  return null;
}

async function fetchYear(corpCode: string, year: number): Promise<YearFinancials | null> {
  const key = getKey();
  // 연결(CFS) 우선, 없으면 별도(OFS)
  for (const fsDiv of ["CFS", "OFS"] as const) {
    const url =
      `${DART_BASE}/fnlttSinglAcntAll.json?crtfc_key=${key}` +
      `&corp_code=${corpCode}&bsns_year=${year}&reprt_code=11011&fs_div=${fsDiv}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = (await res.json()) as { status?: string; list?: DartRow[] };
    if (data.status !== "000" || !Array.isArray(data.list)) continue;

    const rows = data.list;
    return {
      year,
      fsDiv,
      revenue: extractAmount(rows, METRICS.revenue.ids, METRICS.revenue.names, METRICS.revenue.sj),
      operatingIncome: extractAmount(
        rows,
        METRICS.operatingIncome.ids,
        METRICS.operatingIncome.names,
        METRICS.operatingIncome.sj
      ),
      netIncome: extractAmount(
        rows,
        METRICS.netIncome.ids,
        METRICS.netIncome.names,
        METRICS.netIncome.sj
      ),
      assets: extractAmount(rows, METRICS.assets.ids, METRICS.assets.names, METRICS.assets.sj),
      liabilities: extractAmount(
        rows,
        METRICS.liabilities.ids,
        METRICS.liabilities.names,
        METRICS.liabilities.sj
      ),
      equity: extractAmount(rows, METRICS.equity.ids, METRICS.equity.names, METRICS.equity.sj),
      operatingCashFlow: extractAmount(
        rows,
        METRICS.operatingCashFlow.ids,
        METRICS.operatingCashFlow.names,
        METRICS.operatingCashFlow.sj
      ),
    };
  }
  return null;
}

export type FinancialsResult =
  | { corp: CorpMatch; years: YearFinancials[]; error?: undefined }
  | { error: string; corp?: undefined; years?: undefined };

/** 회사명/코드를 받아 최근 사업보고서 기준 데이터가 있는 3개년을 모아 반환한다. */
export async function getFinancials(input: string): Promise<FinancialsResult> {
  const corp = findCorp(input);
  if (!corp) {
    return {
      error:
        "회사를 찾을 수 없습니다. 정식 회사명(예: 삼성전자)으로 입력하거나 6자리 종목코드(예: 005930)로 다시 시도해보세요.",
    };
  }

  // 최근 5개년 후보를 동시에 조회한 뒤, 데이터가 있는 최신 3개년만 사용
  const currentYear = new Date().getFullYear();
  const candidateYears = [1, 2, 3, 4, 5].map((d) => currentYear - d);
  const fetched = await Promise.all(candidateYears.map((y) => fetchYear(corp.corp_code, y)));
  const years = fetched
    .filter((y): y is YearFinancials => y !== null)
    .sort((a, b) => b.year - a.year)
    .slice(0, 3);

  if (years.length === 0) {
    return {
      error: `'${corp.corp_name}'의 사업보고서 재무제표를 찾지 못했습니다. 금융사(은행·보험·증권)는 형식이 달라 조회가 어려울 수 있어요. 일반 제조·서비스 상장사로 시도해보세요.`,
    };
  }

  return { corp, years };
}

/* ──────────────────────────────────────────────
 * 3) 공시 내역 조회 (공시검색 list.json)
 *    corp_code로 최근 3개월 공시 목록을 가져온다.
 * ────────────────────────────────────────────── */
export type Disclosure = {
  report_nm: string; // 보고서명
  rcept_dt: string; // 접수일자 YYYYMMDD
  flr_nm: string; // 제출인
  rcept_no: string; // 접수번호
  url: string; // DART 원문 링크
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export async function getDisclosures(corpCode: string): Promise<Disclosure[]> {
  const key = getKey();
  const end = new Date();
  const begin = new Date();
  begin.setMonth(begin.getMonth() - 3); // 최근 3개월

  const url =
    `${DART_BASE}/list.json?crtfc_key=${key}&corp_code=${corpCode}` +
    `&bgn_de=${ymd(begin)}&end_de=${ymd(end)}&page_count=15&page_no=1`;

  let data: { status?: string; list?: Record<string, string>[] };
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }
  if (data.status !== "000" || !Array.isArray(data.list)) return [];

  return data.list.map((d) => {
    const rcept_no = (d.rcept_no ?? "").trim();
    return {
      report_nm: (d.report_nm ?? "").trim(),
      rcept_dt: (d.rcept_dt ?? "").trim(),
      flr_nm: (d.flr_nm ?? "").trim(),
      rcept_no,
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept_no}`,
    };
  });
}
