-- Migration: add checked_at column and index for goal_cells
-- Run this against your Postgres database (e.g. via psql or Supabase CLI)

ALTER TABLE goal_cells
ADD COLUMN IF NOT EXISTS checked_at timestamptz;

CREATE INDEX IF NOT EXISTS goal_cells_goal_checked_at_idx
ON goal_cells (goal_id, checked_at);
