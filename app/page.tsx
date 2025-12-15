"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      // 1) If Supabase redirected back with tokens in the URL hash (#access_token=...)
      // supabase-js v2 can automatically pick it up on init, but to be safe we just
      // refresh session once.
      await supabaseClient.auth.getSession();

      // 2) Now route based on session
      const { data } = await supabaseClient.auth.getSession();
      if (data.session) {
        router.replace("/ai-demo");
      } else {
        router.replace("/login");
      }
    };

    run();
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
      <p className="text-slate-400 text-sm">Redirecting…</p>
    </main>
  );
}
