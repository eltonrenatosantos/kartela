-- Migration: add deadline column to goals
-- Run this against your Postgres database (psql or Supabase CLI)

ALTER TABLE public.goals
ADD COLUMN IF NOT EXISTS deadline timestamptz;

CREATE INDEX IF NOT EXISTS goals_deadline_idx ON public.goals(deadline);
