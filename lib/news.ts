// 구글 뉴스 RSS로 회사명 관련 최근 기사를 가져온다. (API 키 불필요, 무료)
export type NewsItem = {
  title: string;
  link: string;
  pubDate: string; // RSS 원본 날짜 문자열
  source: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

export async function getNews(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  let xml: string;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3); // 최근 3개월

  const items: NewsItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && items.length < 12) {
    const block = m[1];
    const title = decodeEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "").trim();
    const source = decodeEntities(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");

    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime()) && d < cutoff) continue; // 3개월보다 오래된 기사 제외
    }
    if (title && link) items.push({ title, link, pubDate, source });
  }
  return items;
}
