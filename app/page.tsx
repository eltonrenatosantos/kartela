"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { generateKartela } from "@/lib/generateKartela";

type Goal = { id: string; title: string; target_amount: number; created_at?: string | null; deadline?: string | null };
type Cell = { id: string; goal_id: string; value: number; is_checked: boolean };

type Screen = "home" | "create" | "grid" | "badges";

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const fmt = (n: number) => n.toLocaleString("pt-BR");
const todayISO = () => {
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// progress hue mapping (wireframe)
function hueForPct(p: number) {
  const start = 18;
  const end = 135;
  return Math.round(start + (end - start) * (p / 100));
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [email, setEmail] = useState<string | null>(null);

  const [cells, setCells] = useState<Cell[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalSums, setGoalSums] = useState<Record<string, number>>({});
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const activeGoal = useMemo(() => goals.find((g) => g.id === activeGoalId) ?? null, [goals, activeGoalId]);
  const [pendingDeleteGoal, setPendingDeleteGoal] = useState<Goal | null>(null);
  const [modalMode, setModalMode] = useState<"pay" | "delete">("pay");
  const [loading, setLoading] = useState(false);

  // create form (mantém o visual do wireframe)
  const [title, setTitle] = useState("Minha meta");
  const [target, setTarget] = useState<number>(1000);
  const [deadline, setDeadline] = useState<string>(todayISO()); // UI only (ainda não persistimos no DB)
  const [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard">("normal");
  const maxCell = 300;

  // badges state
  const [badgesLoading, setBadgesLoading] = useState(false);
  const [totalSaved, setTotalSaved] = useState<number>(0);
  const [completedGoals, setCompletedGoals] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);

  // responsive columns for badges grid
  const [cols, setCols] = useState<number>(() => (typeof window !== "undefined" && window.innerWidth > 900 ? 3 : 2));
  useEffect(() => {
    const onResize = () => setCols(window.innerWidth > 900 ? 3 : 2);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // BadgeCard component (internal)
  function BadgeCard({
    label,
    desc,
    unlocked,
    tone,
  }: {
    label: string;
    desc: string;
    unlocked: boolean;
    tone: "bronze" | "silver" | "gold" | "emerald" | "blue" | "purple" | "gray";
  }) {
    const palette: Record<string, string> = {
      bronze: "#CD7F32",
      silver: "#9CA3AF",
      gold: "#F59E0B",
      emerald: "#22C55E",
      blue: "#3B82F6",
      purple: "#A78BFA",
      gray: "#94A3B8",
    };
    const color = unlocked ? palette[tone] : palette["gray"];
    const opacity = unlocked ? 1 : 0.45;

    return (
      <div
        className="card"
        style={{
          borderRadius: 18,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
          opacity,
          boxShadow: "0 6px 18px rgba(15,23,42,0.04)",
          border: "1px solid rgba(2,6,23,0.06)",
        }}
      >
        <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 20 }}>{label}</div>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 999,
              background: color,
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              flex: "0 0 auto",
            }}
            aria-hidden
          >
            {/* medal ribbons */}
            <div style={{ position: "absolute", bottom: -10, left: 8, width: 12, height: 18, borderRadius: 4, transform: "skewX(-8deg)", background: color }} />
            <div style={{ position: "absolute", bottom: -10, right: 8, width: 12, height: 18, borderRadius: 4, transform: "skewX(8deg)", background: color }} />
            {/* inner circle highlight */}
            <div style={{ width: 26, height: 26, borderRadius: 999, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
              {unlocked ? "✓" : ""}
            </div>
          </div>
        </div>
        <div style={{ color: unlocked ? "#0F172A" : "#475569", fontSize: 13 }}>{desc}</div>
      </div>
    );
  }

  // call RPC when entering badges screen
  useEffect(() => {
    if (screen === "badges") loadBadges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const [pendingCell, setPendingCell] = useState<Cell | null>(null);
  const [justPaidId, setJustPaidId] = useState<string | null>(null);
  const [justCheckedId, setJustCheckedId] = useState<string | null>(null);

  // toast / confetti / pulse
  const [toastMsg, setToastMsg] = useState<string>("");
  const [toastShow, setToastShow] = useState(false);
  const toastTimer = useRef<number | null>(null);

  // money pop state (rendered inside #grid so it's positioned relative to the cells)
  const [moneyPops, setMoneyPops] = useState<{ id: string; left: number; top: number; value: number }[]>([]);
  const lastClickPosRef = useRef<{ left: number; top: number } | null>(null);

  const [confettiShow, setConfettiShow] = useState(false);
  const [confettiBits, setConfettiBits] = useState<
    { leftPct: number; topPx: number; durMs: number; color: string }[]
  >([]);
  const confettiTimer = useRef<number | null>(null);

  // completion overlay state (show once per goal)
  const [completionShow, setCompletionShow] = useState(false);
  const completedShownForGoalRef = useRef<string | null>(null);

  const lastStepRef = useRef<number>(0);
  const progressPulseRef = useRef<boolean>(false);

  const progress = useMemo(() => {
    if (!activeGoal) return { saved: 0, pct: 0 };
    const saved = cells.reduce((acc, c) => acc + (c.is_checked ? c.value : 0), 0);
    const pct = activeGoal.target_amount > 0 ? clamp((saved / activeGoal.target_amount) * 100, 0, 100) : 0;
    return { saved, pct };
  }, [activeGoal, cells]);

  // set CSS var for progress hue (wireframe)
  useEffect(() => {
    document.documentElement.style.setProperty("--progHue", String(hueForPct(progress.pct)));
  }, [progress.pct]);

  // sort goals so incomplete (active) first, completed last
  const sortedGoals = useMemo(() => {
    return [...goals].sort((a, b) => {
      const aSaved = (goalSums[a.id] ?? 0) as number;
      const bSaved = (goalSums[b.id] ?? 0) as number;
      const aPct = a.target_amount ? clamp((aSaved / a.target_amount) * 100, 0, 100) : 0;
      const bPct = b.target_amount ? clamp((bSaved / b.target_amount) * 100, 0, 100) : 0;
      const aDone = aPct >= 100;
      const bDone = bPct >= 100;
      if (aDone === bDone) return 0;
      return aDone ? 1 : -1;
    });
  }, [goals, goalSums]);

  function toast(msg: string) {
    setToastMsg(msg);
    setToastShow(true);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastShow(false), 1600);
  }

  // play short tick via Web Audio API (safe, on-demand)
  const audioCtxRef = useRef<AudioContext | null>(null);
  function playTick() {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      o.start(now);
      o.stop(now + 0.09);
    } catch (err) {
      // audio blocked or not available — ignore
      console.warn("Audio tick unavailable", err);
    }
  }

  function spawnMoneyPop(left: number, top: number, value: number) {
    const id = String(Math.random()).slice(2);
    setMoneyPops((prev) => [...prev, { id, left, top, value }]);
    window.setTimeout(() => setMoneyPops((prev) => prev.filter((p) => p.id !== id)), 900);
  }

  function burstConfetti(n: number) {
    const colors = ["#22C55E", "#16A34A", "#F59E0B", "#3B82F6", "#A78BFA", "#FB7185"];
    const bits = Array.from({ length: n }, () => ({
      leftPct: Math.random() * 100,
      topPx: -10 - Math.random() * 40,
      durMs: 700 + Math.random() * 600,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    setConfettiBits(bits);
    setConfettiShow(true);
    if (confettiTimer.current) window.clearTimeout(confettiTimer.current);
    confettiTimer.current = window.setTimeout(() => setConfettiShow(false), 900);
  }

  function pulseProgress() {
    progressPulseRef.current = true;
    // força re-render para aplicar class
    setPulseTick((x) => x + 1);
    window.setTimeout(() => {
      progressPulseRef.current = false;
      setPulseTick((x) => x + 1);
    }, 220);
  }
  const [, setPulseTick] = useState(0);

  // auth init
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loginGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
  };

  
  const logout = async () => {
    await supabase.auth.signOut();
    setActiveGoalId(null);
    setCells([]);
    setScreen("home");
  };

  async function loadCells(goalId: string) {
    setLoading(true);
    try {
      const { data: c, error: cErr } = await supabase
        .from("goal_cells")
        .select("id,goal_id,value,is_checked,checked_at")
        .eq("goal_id", goalId)
        .order("created_at", { ascending: true });

      if (cErr) throw cErr;
      setCells(c ?? []);
    } catch (e: any) {
      toast(e?.message ?? "Erro ao carregar células.");
    } finally {
      setLoading(false);
    }
  }

  async function loadGoals() {
    setLoading(true);
    try {
      const { data: g, error: gErr } = await supabase
        .from("goals")
        .select("id,title,target_amount,created_at,deadline")
        .order("created_at", { ascending: false });

      if (gErr) throw gErr;

      const list = g ?? [];
      setGoals(list);

      // fetch per-goal saved amounts by aggregating checked goal_cells (server-side)
      try {
        const ids = list.map((x) => x.id);
        if (ids.length > 0) {
          const { data: cellsAll, error: cellsErr } = await supabase
            .from("goal_cells")
            .select("goal_id,value,is_checked")
            .in("goal_id", ids)
            .eq("is_checked", true);
          if (cellsErr) throw cellsErr;
          const sums: Record<string, number> = {};
          (cellsAll ?? []).forEach((c: any) => {
            sums[c.goal_id] = (sums[c.goal_id] ?? 0) + (c.value ?? 0);
          });
          setGoalSums(sums);
        } else {
          setGoalSums({});
        }
      } catch (err) {
        // non-fatal: keep existing goals but log toast
        console.error(err);
        setGoalSums({});
      }

      if (list.length === 0) {
        setActiveGoalId(null);
        setCells([]);
        return;
      }

      if (!activeGoalId) {
        const first = list[0];
        setActiveGoalId(first.id);
        await loadCells(first.id);
      } else {
        const active = list.find((x) => x.id === activeGoalId) ?? list[0];
        await loadCells(active.id);
      }
      
    } catch (e: any) {
      toast(e?.message ?? "Erro ao carregar metas.");
    } finally {
      setLoading(false);
    }
  }

  // load metrics for badges screen
  async function loadBadges() {
    setBadgesLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_user_stats");
      if (error) throw error;
      if (!data || data.length === 0) {
        setTotalSaved(0);
        setCompletedGoals(0);
        setStreak(0);
      } else {
        const row = data[0] as any;
        setTotalSaved(Number(row.total_saved ?? 0));
        setCompletedGoals(Number(row.completed_goals ?? 0));
        setStreak(Number(row.best_streak ?? 0));
      }
    } catch (e: any) {
      console.error(e);
      toast(e?.message ?? "Erro ao carregar medalhas.");
      setTotalSaved(0);
      setCompletedGoals(0);
      setStreak(0);
    } finally {
      setBadgesLoading(false);
    }
  }

  useEffect(() => {
    if (email) loadGoals();
  }, [email]);

  useEffect(() => {
    if (!activeGoalId) return;
    loadCells(activeGoalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoalId]);



  async function createGoalAndKartela() {
    setLoading(true);
    try {
      const { data: userRes, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const user = userRes.user;
      if (!user) throw new Error("Usuário não autenticado.");

      const targetAmount = Math.round(Number(target));
      let avg = 50;
      if (difficulty === "easy") avg = 30;
      if (difficulty === "normal") avg = 50;
      if (difficulty === "hard") avg = 120;
      const n = Math.max(10, Math.round(targetAmount / avg));

      if (!Number.isFinite(targetAmount) || targetAmount < 10) {
        toast("Preencha valor (>= 10).");
        return;
      }
      if (!Number.isFinite(n) || n < 10) {
        toast("Quantidade de números muito baixa (>= 10).");
        return;
      }

      const values = generateKartela(targetAmount, n, maxCell);

      const { data: gIns, error: gErr } = await supabase
        .from("goals")
        .insert([{ user_id: user.id, title: title.trim() || "Minha meta", target_amount: targetAmount, deadline: deadline || null }])
        .select("id,title,target_amount,created_at,deadline")
        .single();

      if (gErr) throw gErr;

      const rows = values.map((v) => ({ goal_id: gIns.id, value: v, is_checked: false }));
      const { error: cErr } = await supabase.from("goal_cells").insert(rows);
      if (cErr) throw cErr;

      toast("Meta criada.");
      // make the newly created goal the active one, reload goals and load its cells
      setActiveGoalId(gIns.id);
      await loadGoals();
      await loadCells(gIns.id);
      setScreen("grid");
    } catch (e: any) {
      toast(e?.message ?? "Erro ao criar meta.");
    } finally {
      setLoading(false);
    }
  }

  function askCheck(cell: Cell, e?: MouseEvent<HTMLDivElement>) {
    if (cell.is_checked) {
      toast("Já marcado.");
      return;
    }
    // capture clicked position relative to #grid so pop can be positioned
    try {
      if (e) {
        const grid = document.getElementById("grid");
        const cellEl = e.currentTarget as HTMLElement;
        if (grid && cellEl) {
          const gRect = grid.getBoundingClientRect();
          const cRect = cellEl.getBoundingClientRect();
          lastClickPosRef.current = { left: cRect.left - gRect.left + cRect.width / 2, top: cRect.top - gRect.top + cRect.height / 2 };
        }
      }
    } catch (err) {
      lastClickPosRef.current = null;
    }
    setPendingCell(cell);
  }

  async function confirmCheck() {
    if (!pendingCell) return;
    const cellToMark = pendingCell; // freeze reference for optimistic updates
    setLoading(true);

    const prevPct = progress.pct;
    const prevStep = Math.floor(prevPct / 5);

    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("goal_cells")
        .update({ is_checked: true, checked_at: now })
        .eq("id", cellToMark.id);
      if (error) throw error;

      // otimista local
      setCells((prev) => prev.map((c) => (c.id === cellToMark.id ? { ...c, is_checked: true, checked_at: now } : c)));

      // justChecked animation
      setJustCheckedId(cellToMark.id);
      window.setTimeout(() => setJustCheckedId(null), 450);

      // update cached per-goal sums so Home updates immediately
      setGoalSums((prev) => {
        const gid = cellToMark.goal_id;
        const add = Number(cellToMark.value ?? 0);
        return { ...(prev ?? {}), [gid]: (prev?.[gid] ?? 0) + add };
      });

      // also update totalSaved used by badges (if visible)
      setTotalSaved((s) => s + (Number(cellToMark.value ?? 0)));

      setJustPaidId(pendingCell.id);
      window.setTimeout(() => setJustPaidId(null), 600);

      // spawn money pop if we have a captured click position
      if (lastClickPosRef.current) {
        spawnMoneyPop(lastClickPosRef.current.left, lastClickPosRef.current.top, Number(cellToMark.value ?? 0));
      }

      setPendingCell(null);

      if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {}

      // play tick (best-effort)
      playTick();

      // recomputa novo pct (sem esperar render) pra efeitos
      // compute new percentage using optimistic value
      const newSaved = progress.saved + Number(cellToMark.value ?? 0);
      const newPct = activeGoal?.target_amount ? clamp((newSaved / activeGoal.target_amount) * 100, 0, 100) : 0;
      const newStep = Math.floor(newPct / 5);

      if (newStep > prevStep) {
        pulseProgress();
        burstConfetti(10);
      }

      toast(`+R$ ${cellToMark.value} guardados`);

      // if we reached 100% for the first time on this goal, show completion overlay
      if (newPct >= 100) {
        if (activeGoal && completedShownForGoalRef.current !== activeGoal.id) {
          setCompletionShow(true);
          completedShownForGoalRef.current = activeGoal.id;
          burstConfetti(42);
        }
      }
    } catch (e: any) {
      toast(e?.message ?? "Erro ao marcar.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    const toDel = pendingDeleteGoal ?? null;
    if (!toDel) return;
    setLoading(true);
    try {
      // delete cells first
      const { error: cErr } = await supabase.from("goal_cells").delete().eq("goal_id", toDel.id);
      if (cErr) throw cErr;

      // then delete goal
      const { error: gErr } = await supabase.from("goals").delete().eq("id", toDel.id);
      if (gErr) throw gErr;

      // fetch remaining goals to update local state
      const { data: remaining, error: rErr } = await supabase
        .from("goals")
        .select("id,title,target_amount,created_at")
        .order("created_at", { ascending: false });
      if (rErr) throw rErr;

      const list = remaining ?? [];
      setGoals(list);

      if (list.length === 0) {
        setActiveGoalId(null);
        setCells([]);
        setScreen("home");
      } else {
        const next = list[0];
        setActiveGoalId(next.id);
        await loadCells(next.id);
      }

      // recompute sums for remaining goals by aggregating checked goal_cells
      try {
        const ids = list.map((x) => x.id);
        if (ids.length > 0) {
          const { data: cellsAll, error: cellsErr } = await supabase
            .from("goal_cells")
            .select("goal_id,value,is_checked")
            .in("goal_id", ids)
            .eq("is_checked", true);
          if (cellsErr) throw cellsErr;
          const sums: Record<string, number> = {};
          (cellsAll ?? []).forEach((c: any) => {
            sums[c.goal_id] = (sums[c.goal_id] ?? 0) + (c.value ?? 0);
          });
          setGoalSums(sums);
        } else {
          setGoalSums({});
        }
      } catch (err) {
        console.error(err);
        setGoalSums({});
      }

      toast("Meta deletada.");
    } catch (e: any) {
      toast(e?.message ?? "Erro ao deletar meta.");
    } finally {
      setLoading(false);
      setPendingDeleteGoal(null);
      setModalMode("pay");
    }
  }

  // ensure lastStepRef follows progress for future expansions
  useEffect(() => {
    lastStepRef.current = Math.floor(progress.pct / 5);
  }, [progress.pct]);

  // UI helpers
  const remaining = activeGoal ? Math.max(0, activeGoal.target_amount - progress.saved) : 0;
  const progressClass = progressPulseRef.current ? "progressPulse" : "";

  function cellClass(v: number) {
    if (v <= 50) return "small";
    if (v <= 150) return "mid";
    return "big";
  }

  // ----- RENDER (wireframe screens) -----

  // login screen (wireframe-ish)
  if (!email) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <div className="logo" />
            <div>Kartela</div>
          </div>
          <div className="pill" id="pillAuth">
            🔐 Login Google
          </div>
        </div>

        <div className="screenTitle">Entrar</div>

        <div className="stack">
          <div className="card">
            <div className="big">Acesse para salvar suas metas</div>
            <div className="hint" style={{ marginTop: 6 }}>
              Login Google + metas privadas (RLS).
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btnPrimary" onClick={loginGoogle}>
                Entrar com Google
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="app">
        {/* topbar */}
        <div className="topbar">
          <div className="brand">
            <div className="logo" />
            <div>Kartela</div>
          </div>

          <div className="pill" title={email}>
            ✅ {email}
          </div>
        </div>

        {/* HOME */}
        {screen === "home" && (
          <div className="screen">
            <div className="screenTitle">Minhas metas</div>

            <div className="stack">
              {sortedGoals.map((g) => {
                const saved = goalSums[g.id] ?? 0;
                const pct = g.target_amount ? clamp((saved / g.target_amount) * 100, 0, 100) : 0;
                const isCompleted = pct >= 100;
                return (
                  <div className="card" key={g.id}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div>
                        <div className="big">{g.title}</div>
                        <div className="muted" style={{ fontWeight: 850, marginTop: 2 }}>{`R$ ${fmt(saved)} / R$ ${fmt(g.target_amount)}`}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn btnSmall btnGhost"
                          onClick={() => {
                            setPendingDeleteGoal(g);
                            setModalMode("delete");
                          }}
                          title={`Deletar meta ${g.title}`}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: "#DC2626" }} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <rect x="6.5" y="6" width="11" height="13" rx="2" stroke="currentColor" strokeWidth="2.6" fill="none" />
                            <rect x="4" y="3" width="16" height="3" rx="1.5" stroke="currentColor" strokeWidth="2.6" fill="none" />
                            <rect x="9" y="9" width="1.8" height="7" rx="0.9" fill="currentColor" />
                            <rect x="11.7" y="9" width="1.8" height="7" rx="0.9" fill="currentColor" />
                            <rect x="14.4" y="9" width="1.8" height="7" rx="0.9" fill="currentColor" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="progressWrap" style={{ marginTop: 10 }}>
                      <div className="progressBar">
                        <div className={`progressFill ${isCompleted ? "completed" : ""}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                        <div className="muted" style={{ fontWeight: 950 }}>{`${Math.round(pct)}%`}</div>
                        <div className="muted" style={{ fontWeight: 950 }}>{isCompleted ? "Meta concluída" : `Faltam R$ ${fmt(Math.max(0, g.target_amount - saved))}`}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <button
                          className="btn btnPrimary"
                          style={{ width: "100%" }}
                          onClick={() => {
                            setActiveGoalId(g.id);
                            setScreen("grid");
                          }}
                        >
                          Ver cartela
                        </button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginLeft: "auto", paddingRight: 6 }}>
                        <div className="chip">⏳ Prazo: <span>{g.deadline ? String(g.deadline).split("T")[0].split("-").reverse().join("/") : "—"}</span></div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CREATE */}
        {screen === "create" && (
          <div className="screen">
            <div className="screenTitle">Criar meta</div>

            <div className="stack">
              <div className="card stack">
                <div className="field">
                  <label>Nome da meta</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: PC gamer" />
                </div>

                <div className="field">
                  <label>Valor total (R$)</label>
                  <input
                    inputMode="numeric"
                    value={String(target)}
                    onChange={(e) => setTarget(Number((e.target.value || "").replace(/[^\d]/g, "")))}
                    placeholder="Ex: 3000"
                  />
                </div>

                <div className="field">
                  <label>Prazo (data final)</label>
                  <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                  <div className="hint">
                    UI do wireframe. (Persistência do prazo você pode adicionar depois no DB.)
                  </div>
                </div>

                <div className="field">
                  <label>Dificuldade</label>
                  <div className="seg">
                    <button className={difficulty === "easy" ? "on" : ""} onClick={() => setDifficulty("easy")}>
                      Fácil
                    </button>
                    <button className={difficulty === "normal" ? "on" : ""} onClick={() => setDifficulty("normal")}>
                      Padrão
                    </button>
                    <button className={difficulty === "hard" ? "on" : ""} onClick={() => setDifficulty("hard")}>
                      Difícil
                    </button>
                  </div>
                </div>

                <button className="btn btnPrimary" onClick={createGoalAndKartela} disabled={loading}>
                  {loading ? "Criando..." : "Confirmar meta"}
                </button>
                <button className="btn btnGhost" onClick={() => setScreen("home")} disabled={loading}>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* GOALS */}
        

        {/* BADGES */}
        {screen === "badges" && (
          <div className="screen">
            <div className="screenTitle">Medalhas</div>

            <div className="stack">
              {/* Valor acumulado section */}
              <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 850, marginBottom: 10 }}>Valor acumulado</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gap: 12,
                  }}
                >
                  {([1000, 5000, 10000, 25000, 50000, 100000] as number[]).map((th, idx) => {
                    const unlocked = totalSaved >= th;
                    const tones: any = ["bronze", "silver", "gold", "emerald", "blue", "purple"];
                    return (
                      <BadgeCard
                        key={th}
                        label={th >= 1000 ? `${th / 1000}K` : String(th)}
                        desc={`Você guardou R$ ${fmt(th)}`}
                        unlocked={unlocked}
                        tone={tones[idx]}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Metas concluídas section */}
              <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 850, marginBottom: 10 }}>Metas concluídas</div>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
                    {([1, 2, 5, 10, 20, 50] as number[]).map((th, idx) => {
                      const unlocked = completedGoals >= th;
                      const tones: any = ["bronze", "silver", "gold", "emerald", "blue", "purple"];
                      return (
                        <BadgeCard key={th} label={`${th}`} desc={`Você concluiu ${th} metas`} unlocked={unlocked} tone={tones[idx]} />
                      );
                    })}
                  </div>
              </div>

              {/* Consistência section */}
              <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 850, marginBottom: 10 }}>Consistência</div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
                  {([4, 7, 20, 30, 90, 180, 365] as number[]).map((th, idx) => {
                    const unlocked = streak >= th;
                    const tones: any = ["bronze", "silver", "gold", "emerald", "blue", "purple", "gold"];
                    let desc = "";
                    if (th === 90) desc = "Você guardou por 3 meses seguidos (90 dias)";
                    else if (th === 180) desc = "Você guardou por 6 meses seguidos (180 dias)";
                    else if (th === 365) desc = "Você guardou por 1 ano seguido (365 dias)";
                    else desc = `Você guardou por ${th} dias seguidos`;
                    return (
                      <BadgeCard key={th} label={`${th}d`} desc={desc} unlocked={unlocked} tone={tones[idx]} />
                    );
                  })}
                </div>
              </div>

              <div className="card" style={{ marginTop: 6 }}>
                <div className="muted">Total guardado</div>
                <div className="big">R$ {fmt(totalSaved)}</div>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <div className="muted">Metas concluídas: <strong>{completedGoals}</strong></div>
                  <div className="muted">Maior sequência: <strong>{streak} dias</strong></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* GRID */}
        {screen === "grid" && (
          <div className="screen">
              <div className="gridHeader">
                  <div className="back" onClick={() => setScreen("home")}>
                    ← Voltar
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btnSmall btnGhost"
                      onClick={() => {
                        if (!activeGoal) return;
                        setPendingDeleteGoal(activeGoal);
                        setModalMode("delete");
                      }}
                      disabled={!activeGoal || loading}
                      title={activeGoal ? `Deletar meta ${activeGoal.title}` : "Sem meta ativa"}
                    >
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        style={{ color: "#DC2626" }}
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <rect x="6.5" y="6" width="11" height="13" rx="2" stroke="currentColor" strokeWidth="2.6" fill="none" />
                        <rect x="4" y="3" width="16" height="3" rx="1.5" stroke="currentColor" strokeWidth="2.6" fill="none" />
                        <rect x="9" y="9" width="1.8" height="7" rx="0.9" fill="currentColor" />
                        <rect x="11.7" y="9" width="1.8" height="7" rx="0.9" fill="currentColor" />
                        <rect x="14.4" y="9" width="1.8" height="7" rx="0.9" fill="currentColor" />
                      </svg>
                    </button>
                    
                  </div>
                </div>

            <div className="card" style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="muted" style={{ fontWeight: 950, fontSize: 12, letterSpacing: ".4px" }}>
                    META
                  </div>
                  <div className="big">{activeGoal?.title ?? "—"}</div>
                    <div className="muted" style={{ fontWeight: 850, marginTop: 2 }}>
                      {activeGoal ? `R$ ${fmt(progress.saved)} / R$ ${fmt(activeGoal.target_amount)}` : "—"}
                    </div>
                </div>
              </div>

              <div className="progressWrap">
                <div className="progressBar">
                  <div className={`progressFill ${progressClass} ${progress.pct >= 100 ? "completed" : ""}`} style={{ width: `${progress.pct}%` }} />
                </div>
                <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                  <div className="muted" style={{ fontWeight: 950 }}>
                    {activeGoal ? `${progress.pct.toFixed(0)}%` : "0%"}
                  </div>
                  <div className="muted" style={{ fontWeight: 950 }}>
                    {activeGoal ? (progress.pct >= 100 ? "Meta concluída" : `Faltam R$ ${fmt(remaining)}`) : "Faltam R$ 0"}
                  </div>
                </div>
              </div>

              <div className="hint" style={{ marginTop: 10 }}>
                Toque um quadrinho e confirme.
              </div>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="big">Cartela</div>
                <div className="muted" style={{ fontWeight: 950, fontSize: 12 }}>
                  Toque e confirme
                </div>
              </div>

              <div className="grid" id="grid">
                {cells.map((c) => (
                  <div
                    key={c.id}
                    onClick={(e) => askCheck(c, e)}
                    className={[
                      "cell",
                      cellClass(c.value),
                      c.is_checked ? "paid" : "",
                      justPaidId === c.id ? "justPaid" : "",
                      justCheckedId === c.id ? "justChecked" : "",
                    ].join(" ")}
                    role="button"
                    aria-disabled={loading || c.is_checked}
                    title={c.is_checked ? "Já marcado" : "Clique para marcar"}
                  >
                    <div className="check">✓</div>
                    <div>R$ {c.value}</div>
                  </div>
                ))}

                {moneyPops.map((p) => (
                  <div
                    key={p.id}
                    className="moneyPop"
                    style={{ left: p.left + "px", top: p.top + "px" }}
                    aria-hidden
                  >
                    +R$ {p.value}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="nav">
        <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}> 
          🏠 Home
        </button>
        <button className={screen === "create" ? "active" : ""} onClick={() => setScreen("create")}> 
          ➕ Meta
        </button>
        <button className={screen === "badges" ? "active" : ""} onClick={() => { setScreen("badges"); }}>
          🏅 Medalhas
        </button>
      </div>

      {/* Modal (wireframe) */}
      <div
        className={`overlay ${pendingCell || pendingDeleteGoal ? "show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setPendingCell(null);
            setPendingDeleteGoal(null);
            setModalMode("pay");
          }
        }}
      >
        <div className="sheet">
          {modalMode === "delete" && pendingDeleteGoal ? (
            <>
              <div className="sheetTitle">Deletar meta {pendingDeleteGoal.title}?</div>
              <div className="sheetSub">Essa ação apaga a meta e a cartela.</div>
              <div className="sheetBtns">
                <button
                  className="btn btnGhost"
                  onClick={() => {
                    setPendingDeleteGoal(null);
                    setModalMode("pay");
                  }}
                  disabled={loading}
                >
                  Cancelar
                </button>
                <button className="btn btnPrimary" onClick={confirmDelete} disabled={loading || !pendingDeleteGoal}>
                  {loading ? "..." : "Deletar"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="sheetTitle">Confirmar depósito</div>
              <div className="sheetSub">
                {pendingCell ? (
                  <>
                    Guardar <strong>R$ {pendingCell.value}</strong> nesta meta?
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div className="sheetBtns">
                <button className="btn btnGhost" onClick={() => setPendingCell(null)} disabled={loading}>
                  Cancelar
                </button>
                <button className="btn btnPrimary" onClick={confirmCheck} disabled={loading || !pendingCell}>
                  {loading ? "..." : "Confirmar"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Toast */}
      <div className={`toast ${toastShow ? "show" : ""}`} id="toast">
        {toastMsg}
      </div>

      {/* Completion overlay */}
      {completionShow && (
        <div className="completionOverlay" onClick={() => setCompletionShow(false)}>
          <div className="completionCard" onClick={(e) => e.stopPropagation()}>
            <div className="sheetTitle">Meta concluída</div>
            <div className="sheetSub">Você fechou a cartela.</div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btnPrimary" onClick={() => setCompletionShow(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confetti */}
      <div className={`confetti ${confettiShow ? "show" : ""}`} id="confetti">
        {confettiBits.map((b, idx) => (
          <i
            key={idx}
            style={{
              left: `${b.leftPct}%`,
              top: `${b.topPx}px`,
              background: b.color,
              animationDuration: `${b.durMs}ms`,
            }}
          />
        ))}
      </div>
    </>
  );
}