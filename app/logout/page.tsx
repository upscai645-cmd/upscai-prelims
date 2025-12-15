// app/logout/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      await supabaseClient.auth.signOut();
      router.replace("/login");
    };
    run();
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
      <p className="text-sm text-slate-400">Logging you out…</p>
    </main>
  );
}
