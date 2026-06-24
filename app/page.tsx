export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 text-center dark:bg-black">
      <div className="max-w-xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-blue-600">
          준비중
        </p>
        <h1 className="text-3xl font-bold leading-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          기업 재무 자동분석 서비스
        </h1>
        <p className="mt-5 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          종목코드를 입력하면 Open DART에서 재무제표를 불러와
          핵심 재무비율을 계산하고, 경쟁사와 비교한 뒤
          Claude가 주가가치·현금 흐름 전망을 분석해 드립니다.
        </p>
        <p className="mt-8 inline-block rounded-full bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          🚧 현재 서비스 준비중입니다
        </p>
        <p className="mt-10 text-xs text-zinc-400">
          본 서비스의 분석은 참고용이며 투자 권유가 아닙니다.
        </p>
      </div>
    </main>
  );
}
