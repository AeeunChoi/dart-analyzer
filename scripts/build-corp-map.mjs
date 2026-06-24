// DART 고유번호 파일(corpCode.zip)을 한 번 받아, "상장사"만 추려
// lib/corp-map.json 으로 저장한다. (새 상장사 반영이 필요하면 다시 실행)
//   실행: node scripts/build-corp-map.mjs
import { unzipSync, strFromU8 } from "fflate";
import { readFileSync, writeFileSync } from "node:fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const key = envText.match(/OPENDART_API_KEY\s*=\s*(.+)/)?.[1]?.trim();
if (!key) throw new Error(".env.local에서 OPENDART_API_KEY를 찾지 못했습니다.");

console.log("DART 고유번호 파일 내려받는 중…");
const res = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${key}`);
if (!res.ok) throw new Error(`다운로드 실패 HTTP ${res.status}`);
const buf = new Uint8Array(await res.arrayBuffer());

const files = unzipSync(buf);
const xmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".xml"));
const xml = strFromU8(files[xmlName]);

const re = /<list>([\s\S]*?)<\/list>/g;
const out = [];
let m;
while ((m = re.exec(xml)) !== null) {
  const b = m[1];
  const c = (b.match(/<corp_code>([\s\S]*?)<\/corp_code>/)?.[1] ?? "").trim();
  const n = (b.match(/<corp_name>([\s\S]*?)<\/corp_name>/)?.[1] ?? "").trim();
  const s = (b.match(/<stock_code>([\s\S]*?)<\/stock_code>/)?.[1] ?? "").trim();
  if (c && s) out.push({ c, n, s }); // 종목코드(s)가 있는 상장사만
}

writeFileSync(new URL("../lib/corp-map.json", import.meta.url), JSON.stringify(out));
console.log(`상장사 ${out.length}개를 lib/corp-map.json에 저장 완료`);
