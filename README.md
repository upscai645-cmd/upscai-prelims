🚀 UPSCAI Prelims – Question Delivery Web App

A modern, AI-ready UPSC PYQ platform built with Next.js + Supabase.

📌 Overview

UPSCAI Prelims is a lightweight, fast, local-first web application designed to:

store UPSC prelims PYQs in a structured database

fetch each question dynamically

display it in a clean exam-like UI

prepare the foundation for an AI reasoning + analysis layer

This README documents the complete architecture, setup steps, and the next layer (AI Analysis).

🏗 Tech Stack
Layer	Technology	Purpose
Frontend	Next.js 16 (App Router)	Render UI, fetch data
Backend	Supabase	Managed Postgres + API
ORM / API	Supabase JS Client	DB operations
Styling	Tailwind CSS	UI components
Hosting	Local dev, optional Vercel	Deployment
AI Layer (Future)	OpenAI GPT-4.1 / GPT-5	Analysis engine
📂 Project Structure
upscai-prelims/
│
├── app/
│   ├── page.tsx            → Fetch question & render UI
│   ├── globals.css
│   └── layout.tsx
│
├── lib/
│   └── supabaseClient.ts   → Supabase client instance
│
├── public/
├── .env.local              → Supabase keys
├── package.json
└── README.md

🗄 Database Schema (Supabase)

Table name: questions

Column	Type	Example
id	int8	1
created_at	timestamptz	auto
year	int8	2025
subject	text	POLITY
question_number	int8	87
question_text	text	Full PYQ

Row Level Security: OFF (for now)

🔑 Environment Variables

Create .env.local:

NEXT_PUBLIC_SUPABASE_URL=your-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

🔌 Supabase Client (lib/supabaseClient.ts)
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

🖥 Fetching Question (app/page.tsx)

Loads the latest question:

const { data } = await supabase
  .from("questions")
  .select("*")
  .order("id", { ascending: false })
  .limit(1);


Rendered cleanly to the UI.

▶️ Running Locally
cd ~/upscai/upscai-prelims
npm install
npm run dev


Runs at:

👉 http://localhost:3000

🎉 What Works Now

✔ Fully connected database
✔ First question loads from Supabase
✔ UI rendering complete
✔ Correct Answer display
✔ Dev server stable
✔ Foundation ready for AI

🌟 NEXT PHASE: AI ANALYSIS LAYER

This layer transforms a prelims question into a complete explanation.

The AI will generate:

the reasoning process

elimination logic

concept tested

topic mapping

difficulty level

hidden traps

explanation

confidence score

🔮 Future AI Pipeline

1️⃣ Fetch question from Supabase
2️⃣ Pass text to AI (GPT-4/5)
3️⃣ Store AI output in question_analysis table
4️⃣ Display reasoning under each question

🧠 AI Output Example
{
  "elimination_steps": "...",
  "explanation": "...",
  "difficulty": "Medium",
  "tags": ["Polity", "Speaker", "Parliament"],
  "confidence": 0.92
}

🧭 Roadmap (Until Smart Elimination AI)
Phase 1 — DONE

✔ Local setup
✔ Supabase schema
✔ Frontend connected
✔ First PYQ rendering

Phase 2 — Coming Up

⬜ Add Polity & Economy PYQs via CSV
⬜ Add UI navigation for next/previous question
⬜ Add subject filters & year filters
⬜ Deploy to Vercel (optional)

Phase 3 — AI Engine Begins

⬜ AI Explanation Engine
⬜ Topic Tagging
⬜ Difficulty Modelling
⬜ Smart Elimination AI — AI explains how to eliminate wrong options