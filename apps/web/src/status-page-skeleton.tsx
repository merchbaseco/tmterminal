const axisDots = Array.from({ length: 25 }, (_, index) => `axis-dot-${index + 1}`);

function SkeletonBlock({ className }: { className: string }) {
  return (
    <span
      className={`block animate-pulse rounded-[2px] bg-muted motion-reduce:animate-none ${className}`}
    />
  );
}

function MetricSkeleton({
  captionWidth,
  labelWidth,
  valueWidth,
}: {
  captionWidth: string;
  labelWidth: string;
  valueWidth: string;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <SkeletonBlock className={`h-5 ${labelWidth}`} />
      <SkeletonBlock className={`h-9 ${valueWidth}`} />
      <SkeletonBlock className={`h-5 ${captionWidth}`} />
    </div>
  );
}

export function StatusPageSkeleton() {
  return (
    <>
      <span aria-label="Loading status" className="sr-only" role="status">
        Loading status
      </span>
      <div aria-hidden="true" data-testid="status-page-skeleton">
        <section className="relative left-1/2 w-dvw -translate-x-1/2">
          <div className="page-shell @container pb-2 sm:pb-4">
            <div className="grid @min-[48rem]:grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
              <div className="grid @min-[36rem]:grid-cols-3 grid-cols-1 gap-x-[clamp(1rem,3vw,3rem)] gap-y-4">
                <MetricSkeleton captionWidth="w-20" labelWidth="w-32" valueWidth="w-44" />
                <MetricSkeleton captionWidth="w-24" labelWidth="w-36" valueWidth="w-28" />
                <MetricSkeleton captionWidth="w-24" labelWidth="w-40" valueWidth="w-32" />
              </div>
              <SkeletonBlock className="h-8 w-16 justify-self-end rounded-full" />
            </div>
          </div>
          <div className="relative h-[clamp(16rem,34vw,28rem)]">
            <svg
              className="absolute inset-x-0 top-3 h-[calc(100%-4rem)] w-full animate-pulse overflow-visible motion-reduce:animate-none"
              preserveAspectRatio="none"
              viewBox="0 0 1000 300"
            >
              <title>Status activity chart loading</title>
              <path
                d="M0 255 C55 230 92 108 142 190 S235 268 294 178 S380 87 426 194 S515 258 568 176 S662 108 714 204 S824 255 868 149 S949 108 1000 196"
                fill="none"
                stroke="var(--muted-foreground)"
                strokeLinecap="round"
                strokeOpacity="0.22"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M0 266 C78 256 121 276 180 262 S289 250 348 270 S451 251 520 264 S631 275 688 258 S790 270 850 259 S945 272 1000 260"
                fill="none"
                stroke="var(--muted-foreground)"
                strokeLinecap="round"
                strokeOpacity="0.12"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="absolute inset-x-6 bottom-[18px] flex justify-between">
              {axisDots.map((dot) => (
                <span className="size-1 rounded-full bg-muted" key={dot} />
              ))}
            </div>
          </div>
        </section>
        <section className="mt-[clamp(2.5rem,5vw,4.5rem)] grid grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] border border-border max-[48rem]:grid-cols-1">
          <div className="border-border border-r py-5 pr-[clamp(1.5rem,3vw,3rem)] pl-4 max-[48rem]:border-r-0 max-[48rem]:pr-4 max-[48rem]:pb-0">
            <SkeletonBlock className="h-5 w-28" />
          </div>
          <div className="grid max-w-[52rem] gap-2 py-5 pr-4 pl-[clamp(1.5rem,3vw,3rem)] max-[48rem]:pt-3 max-[48rem]:pl-4">
            <SkeletonBlock className="h-5 w-full max-w-[42rem]" />
            <SkeletonBlock className="h-5 w-2/3 max-w-[30rem]" />
          </div>
        </section>
      </div>
    </>
  );
}
