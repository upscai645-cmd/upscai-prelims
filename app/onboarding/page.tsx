// app/onboarding/page.tsx
import { Suspense } from "react";
import OnboardingClient from "./OnboardingClient";

export default function OnboardingPage() {
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
      <OnboardingClient />
    </Suspense>
  );
}
