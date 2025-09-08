"use client";

export function AssistantLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <PulseAvatar />
        <div>
          <div className="text-ui-fg-base font-medium">Assistant is thinking…</div>
          <TypingDots />
        </div>
      </div>
      <ProgressStripe />
      <ChartGhost height={300} />
      <AnswerSkeleton lines={5} />
    </div>
  );
}

export function TypingDots() {
  return (
    <div
      className="flex items-center gap-1 text-ui-fg-subtle text-xs"
      aria-live="polite"
    >
      <span>Preparing response</span>
      <span className="relative inline-block" style={{ width: 24, height: 10 }}>
        <style>
          {`@keyframes bounce { 0%,80%,100% { transform: translateY(0); opacity: .4 } 40% { transform: translateY(-3px); opacity: 1 } }`}
        </style>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              left: i * 8,
              width: 6,
              height: 6,
              borderRadius: 9999,
              background: "currentColor",
              animation: `bounce 1.4s ${i * 0.15}s infinite ease-in-out`,
            }}
          />
        ))}
      </span>
    </div>
  );
}

export function ProgressStripe() {
  return (
    <div className="w-full h-1.5 overflow-hidden rounded bg-ui-bg-subtle border">
      <style>
        {`@keyframes slide { 0% { transform: translateX(-100%);} 100% { transform: translateX(100%);} }`}
      </style>
      <div
        style={{
          width: "40%",
          height: "100%",
          background:
            "linear-gradient(90deg, rgba(99,102,241,0.2), rgba(99,102,241,0.6))",
          animation: "slide 1.2s infinite",
        }}
      />
    </div>
  );
}

export function ChartGhost({ height = 280 }: { height?: number }) {
  return (
    <div
      className="rounded-md border"
      style={{
        height,
        background:
          "repeating-linear-gradient(0deg, var(--bg,#0b0b0b00), var(--bg,#0b0b0b00) 18px, rgba(100,116,139,0.08) 18px, rgba(100,116,139,0.08) 19px)",
      }}
    >
      <style>{`:root { --bg: transparent; }`}</style>
    </div>
  );
}

export function AnswerSkeleton({ lines = 5 }: { lines?: number }) {
  return (
    <div className="grid gap-2">
      <style>
        {`@keyframes shimmer { 0% { transform: translateX(-100%);} 100% { transform: translateX(100%);} }`}
      </style>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-ui-bg-subtle overflow-hidden">
          <div
            style={{
              width: "50%",
              height: "100%",
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)",
              animation: "shimmer 1.2s infinite",
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function PulseAvatar() {
  return (
    <div style={{ position: "relative", width: 28, height: 28 }} aria-hidden="true">
      <style>
        {`@keyframes pulse { 0% { opacity: .6; transform: scale(1);} 50% { opacity: 1; transform: scale(1.06);} 100% { opacity: .6; transform: scale(1);} }`}
      </style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 9999,
          background: "radial-gradient(circle at 30% 30%, #6366f1, #4338ca)",
          boxShadow: "0 0 0 2px rgba(99,102,241,0.3)",
          animation: "pulse 1.8s ease-in-out infinite",
        }}
      />
    </div>
  );
}
