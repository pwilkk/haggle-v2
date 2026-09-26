"use client";

import { useState } from "react";
import { Composer } from "@/components/Composer";
import { Header } from "@/components/Header";

export default function HomePage() {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex min-h-screen flex-col">
      <Header onNewChat={() => setDraft("")} />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-5 py-8" />
      </main>
      <Composer value={draft} onChange={setDraft} />
    </div>
  );
}
