// app/onboarding/page.tsx
import { Suspense } from "react";
import OnboardingClient from "./OnboardingClient";

type Props = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function pickRedirect(searchParams?: Props["searchParams"]) {
  const raw = searchParams?.redirect;
  const r = Array.isArray(raw) ? raw[0] : raw;
  return r && r.startsWith("/") ? r : "/practice";
}

export default function OnboardingPage({ searchParams }: Props) {
  const redirectTo = pickRedirect(searchParams);

  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-slate-50 px-6 py-10">
          <div className="max-w-md mx-auto text-sm text-slate-400">
            Loading onboarding…
          </div>
        </main>
      }
    >
      <OnboardingClient redirectTo={redirectTo} />
    </Suspense>
  );
}
