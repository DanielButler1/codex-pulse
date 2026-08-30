"use client";

import { useEffect, useMemo, useState } from "react";

type Reset = { id: number; label: string; at: string };
type Saved = { primary: string; weekly: string; resets: Reset[] };
const seed: Saved = {
  primary: "",
  weekly: "",
  resets: [
    { id: 1, label: "Primary window", at: "" },
    { id: 2, label: "Weekly window", at: "" },
  ],
};
const pct = (value: string) => value === "" ? "—" : `${Math.max(0, Math.min(100, Number(value)))}%`;
const formatReset = (value: string) => value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Add a reset time";

export default function Dashboard({ userName, userEmail, signOut }:{userName:string; userEmail:string; signOut:string}) {
  const [saved, setSaved] = useState<Saved>(seed);
  const [editing, setEditing] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem("codex-pulse-manual-data");
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Saved>;
          setSaved({ ...seed, ...parsed, resets: parsed.resets ?? seed.resets });
        }
      } catch { /* use the empty manual state */ }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const update = (next: Partial<Saved>) => setSaved(current => ({ ...current, ...next }));
  const persist = () => {
    window.localStorage.setItem("codex-pulse-manual-data", JSON.stringify(saved));
    setEditing(false);
  };
  const primaryUsed = saved.primary === "" ? null : Number(saved.primary);
  const weeklyUsed = saved.weekly === "" ? null : Number(saved.weekly);
  const nextReset = useMemo(() => saved.resets.filter(item => item.at).sort((a,b) => a.at.localeCompare(b.at))[0], [saved.resets]);

  return <main className="shell">
    <header className="topbar"><div className="brand"><div className="mark" /> Codex Pulse</div><div className="user"><a className="nav-link" href="/leaderboard">Leaderboard</a><span>{userName} · {userEmail}</span><a href={signOut}>Sign out</a></div></header>
    <section className="intro"><div><div className="eyebrow">Private telemetry / manual mode</div><h1>Your usage, without the guesswork.</h1><p>Keep the useful part of Codex Pulse online without depending on rotating machine credentials. Enter the percentages you see and keep your reset schedule in one place.</p></div><div className="sync"><span />{hydrated ? "SAVED IN THIS BROWSER" : "LOADING LOCAL DATA"}</div></section>
    <section className="grid">
      <article className="card metric accent"><div className="eyebrow">Primary window</div><h2 className="metric-value">{primaryUsed == null ? "—" : pct(String(100 - primaryUsed))}</h2><p>capacity remaining</p></article>
      <article className="card metric"><div className="eyebrow">Weekly window</div><h2>{weeklyUsed == null ? "—" : pct(String(100 - weeklyUsed))}</h2><p>capacity remaining</p></article>
      <article className="card metric"><div className="eyebrow">Next reset</div><h2 style={{fontSize: "25px", lineHeight: 1.05}}>{nextReset ? formatReset(nextReset.at) : "—"}</h2><p>manual schedule</p></article>
      <article className="card metric"><div className="eyebrow">Data mode</div><h2>Manual</h2><p>no server secret needed</p></article>

      <article className="card wide"><div className="card-head"><div><h3>Current usage</h3><p className="sub">Enter the used percentage shown in your Codex client.</p></div><button className="pill" onClick={() => setEditing(!editing)}>{editing ? "Editing" : "Edit values"}</button></div>
        {editing ? <div className="list"><label className="row"><span>Primary used %</span><input aria-label="Primary used percentage" type="number" min="0" max="100" value={saved.primary} onChange={event => update({primary:event.target.value})} /></label><label className="row"><span>Weekly used %</span><input aria-label="Weekly used percentage" type="number" min="0" max="100" value={saved.weekly} onChange={event => update({weekly:event.target.value})} /></label><button className="save" onClick={persist}>Save manual data</button></div> : <div className="manual-summary"><div><span>Primary used</span><strong>{pct(saved.primary)}</strong></div><div><span>Weekly used</span><strong>{pct(saved.weekly)}</strong></div></div>}
      </article>

      <article className="card side"><div className="card-head"><div><h3>Manual resets</h3><p className="sub">Stored locally in this browser.</p></div></div><div className="list">{saved.resets.map(reset => <div className="row" key={reset.id}><span>{reset.label}</span><strong>{formatReset(reset.at)}</strong></div>)}</div>{editing && <div className="list">{saved.resets.map(reset => <label className="reset-input" key={reset.id}><span>{reset.label}</span><input type="datetime-local" value={reset.at} onChange={event => update({resets:saved.resets.map(item => item.id === reset.id ? {...item, at:event.target.value} : item)})} /></label>)}</div>}</article>

      <article className="card wide"><div className="card-head"><div><h3>Usage rhythm</h3><p className="sub">A lightweight static view until you choose to update the numbers.</p></div><div className="eyebrow">MANUAL</div></div><div className="chart static-chart"><div className="bar-wrap"><div className="bar" style={{height:`${Math.max(4, primaryUsed ?? 0)}%`}} /><span className="bar-label">Primary</span></div><div className="bar-wrap"><div className="bar" style={{height:`${Math.max(4, weeklyUsed ?? 0)}%`, background:"linear-gradient(180deg, var(--orange), #ffc18d)"}} /><span className="bar-label">Weekly</span></div></div></article>
      <article className="card side"><div className="card-head"><div><h3>Provider health</h3><p className="sub">Static personal workspace</p></div></div><div className="provider"><span>Codex<small style={{display:"block",color:"var(--muted)",marginTop:4}}>Manual usage entry</small></span><span className="pill">Ready</span></div><div className="notice">Your desktop rollout logs and credentials stay on your machine. This page only stores the values you choose to enter.</div></article>
    </section>
    <footer>Private by policy · manual values stay in this browser · {userEmail}</footer>
  </main>;
}
