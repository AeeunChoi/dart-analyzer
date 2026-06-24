import { unzipSync, strFromU8 } from "fflate";

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
 *    DART가 주는 corpCode.zip을 받아 압축을 풀고,
 *    그 안의 XML을 파싱해 (회사명, 고유번호, 종목코드) 목록을 만든다.
 *    한 번 받으면 메모리에 캐시해 재사용한다.
 * ────────────────────────────────────────────── */
type CorpEntry = { corp_code: string; corp_name: string; stock_code: string };
let corpCache: CorpEntry[] | null = null;

async function getCorpList(): Promise<CorpEntry[]> {
  if (corpCache) return corpCache;
  const key = getKey();
  const res = await fetch(`${DART_BASE}/corpCode.xml?crtfc_key=${key}`);
  if (!res.ok) throw new Error(`DART 고유번호 파일 다운로드 실패 (HTTP ${res.status})`);

  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf);
  const xmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".xml"));
  if (!xmlName) throw new Error("고유번호 압축파일 안에 XML이 없습니다.");
  const xml = strFromU8(files[xmlName]);

  const entries: CorpEntry[] = [];
  const re = /<list>([\s\S]*?)<\/list>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const corp_code = (block.match(/<corp_code>([\s\S]*?)<\/corp_code>/)?.[1] ?? "").trim();
    const corp_name = (block.match(/<corp_name>([\s\S]*?)<\/corp_name>/)?.[1] ?? "").trim();
    const stock_code = (block.match(/<stock_code>([\s\S]*?)<\/stock_code>/)?.[1] ?? "").trim();
    if (corp_code) entries.push({ corp_code, corp_name, stock_code });
  }
  corpCache = entries;
  return entries;
}

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
export async function findCorp(input: string): Promise<CorpMatch | null> {
  const q = input.trim();
  if (!q) return null;
  const list = await getCorpList();

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
  const corp = await findCorp(input);
  if (!corp) {
    return {
      error:
        "회사를 찾을 수 없습니다. 정식 회사명(예: 삼성전자)으로 입력하거나 6자리 종목코드(예: 005930)로 다시 시도해보세요.",
    };
  }

  const currentYear = new Date().getFullYear();
  const years: YearFinancials[] = [];
  // 최근 연도부터 거슬러 올라가며 데이터가 있는 3개년 수집
  for (let y = currentYear - 1; y >= currentYear - 7 && years.length < 3; y--) {
    const yf = await fetchYear(corp.corp_code, y);
    if (yf) years.push(yf);
  }

  if (years.length === 0) {
    return {
      error: `'${corp.corp_name}'의 사업보고서 재무제표를 찾지 못했습니다. 금융사(은행·보험·증권)는 형식이 달라 조회가 어려울 수 있어요. 일반 제조·서비스 상장사로 시도해보세요.`,
    };
  }

  return { corp, years };
}
