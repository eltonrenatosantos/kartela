-- Migration: create get_user_stats RPC
-- Returns a single row with total_saved, completed_goals, best_streak for current user (auth.uid())

CREATE OR REPLACE FUNCTION public.get_user_stats()
RETURNS TABLE(total_saved bigint, completed_goals int, best_streak int)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH user_goals AS (
  SELECT g.id, g.target_amount
  FROM public.goals g
  WHERE g.user_id = auth.uid()
),
checked AS (
  SELECT gc.goal_id, gc.value, (gc.checked_at::date) as d
  FROM public.goal_cells gc
  JOIN public.goals g ON g.id = gc.goal_id
  WHERE gc.is_checked = true AND g.user_id = auth.uid()
),
-- total saved across all goals for this user
total AS (
  SELECT COALESCE(SUM(value), 0)::bigint AS total_saved FROM checked
),
-- completed goals count (sum checked per goal >= target_amount)
completed AS (
  SELECT COUNT(*)::int AS completed_goals
  FROM user_goals ug
  LEFT JOIN (
    SELECT goal_id, COALESCE(SUM(value),0) AS s
    FROM checked
    GROUP BY goal_id
  ) cs ON cs.goal_id = ug.id
  WHERE COALESCE(cs.s,0) >= ug.target_amount
),
-- best streak (longest run of consecutive dates where user checked at least once)
best AS (
  SELECT COALESCE(MAX(cnt), 0)::int AS best_streak FROM (
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT DISTINCT d FROM checked
    ) dd
    GROUP BY (d - (ROW_NUMBER() OVER (ORDER BY d) * INTERVAL '1 day'))
  ) s
)
SELECT total.total_saved, completed.completed_goals, best.best_streak FROM total, completed, best;
$$;

-- Ensure the function is owned by the current role
ALTER FUNCTION public.get_user_stats() OWNER TO CURRENT_USER;
