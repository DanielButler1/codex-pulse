"use client";

/* Leaderboard avatars are user-provided data URLs and intentionally bypass image optimization. */
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import { useMemo, useState } from "react";

type WindowKey = "today" | "all";
type Leader = { display_name: string; avatar_data_url: string; all_time_tokens: number; all_time_cost_cents: number; today_tokens: number; today_cost_cents: number; updated_at: number };
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function Leaderboard({ entries }: { entries: Leader[] }) {
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [metric, setMetric] = useState<"tokens" | "spend">("tokens");
  const ranked = useMemo(() => [...entries].sort((a, b) => {
    const key = windowKey === "today" ? metric === "tokens" ? "today_tokens" : "today_cost_cents" : metric === "tokens" ? "all_time_tokens" : "all_time_cost_cents";
    return b[key] - a[key];
  }), [entries, metric, windowKey]);
  const allTimeLeader = [...entries].sort((a, b) => b.all_time_tokens - a.all_time_tokens)[0];
  const todayLeader = [...entries].sort((a, b) => b.today_tokens - a.today_tokens)[0];

  return <main className="leader-shell">
    <header className="leader-topbar"><a className="brand" href="/"><span className="mark" /> Codex Pulse</a><nav className="leader-nav" aria-label="Primary navigation"><a href="/">My usage</a><span className="active">Leaderboard</span></nav><div className="leader-user"><span>Updated hourly</span></div></header>
    <section className="leader-hero"><div><div className="eyebrow">Community / opt-in</div><h1>Who is pushing<br />Codex the furthest?</h1></div><p>Real aggregate totals uploaded by Codex Pulse. Prompts, code, file paths, repositories, email, and raw session logs never leave the device.</p></section>
    <section className="record-grid" aria-label="Community records"><article className="record lime-record"><span>All-time token leader</span><strong>{allTimeLeader ? compact.format(allTimeLeader.all_time_tokens) : "—"}</strong><small>{allTimeLeader?.display_name ?? "Waiting for the first opt-in"}</small></article><article className="record"><span>Today’s token leader</span><strong>{todayLeader ? compact.format(todayLeader.today_tokens) : "—"}</strong><small>{todayLeader?.display_name ?? "No uploads yet today"}</small></article><article className="record"><span>Community builders</span><strong>{entries.length}</strong><small>sharing aggregate usage</small></article></section>
    <section className="leader-card"><div className="leader-card-head"><div><div className="preview-pill">Live data</div><h2>Global leaderboard</h2><p>Spend is an API-equivalent estimate calculated locally by Codex Pulse.</p></div><div className="leader-controls" aria-label="Leaderboard filters"><div className="segmented"><button className={metric === "tokens" ? "selected" : ""} onClick={() => setMetric("tokens")}>Tokens</button><button className={metric === "spend" ? "selected" : ""} onClick={() => setMetric("spend")}>Spend</button></div><div className="segmented"><button className={windowKey === "today" ? "selected" : ""} onClick={() => setWindowKey("today")}>Today</button><button className={windowKey === "all" ? "selected" : ""} onClick={() => setWindowKey("all")}>All time</button></div></div></div>
      <div className="table-wrap"><table><thead><tr><th>#</th><th>Builder</th><th>Est. spend</th><th>Tokens</th><th>Last upload</th></tr></thead><tbody>{ranked.length ? ranked.map((leader, index) => <tr key={`${leader.display_name}-${leader.updated_at}-${index}`}><td><span className={`rank rank-${index + 1}`}>{index + 1}</span></td><td><div className="builder">{leader.avatar_data_url ? <img className="avatar" src={leader.avatar_data_url} alt="" /> : <span className="avatar">{initials(leader.display_name)}</span>}<span><strong>{leader.display_name}</strong><small>Codex Pulse</small></span></div></td><td>{money.format((windowKey === "today" ? leader.today_cost_cents : leader.all_time_cost_cents) / 100)}</td><td>{compact.format(windowKey === "today" ? leader.today_tokens : leader.all_time_tokens)}</td><td>{formatUpdated(leader.updated_at)}</td></tr>) : <tr><td colSpan={5}>No one has opted in yet. Enable Community leaderboard in Codex Pulse Settings to claim the first spot.</td></tr>}</tbody></table></div>
    </section>
    <section className="verification"><div><div className="eyebrow">Privacy boundary</div><h2>Only four usage totals leave your device.</h2></div><div className="verification-steps"><p><span>01</span><strong>You opt in</strong> and choose a public name and photo.</p><p><span>02</span><strong>Pulse uploads hourly</strong> with all-time and today’s tokens and estimated spend.</p><p><span>03</span><strong>Leave anytime</strong> to delete the hosted entry without touching local history.</p></div></section>
    <footer>Codex Pulse community leaderboard · private by default</footer>
  </main>;
}

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CP"; }
function formatUpdated(value: number) { const minutes = Math.max(0, Math.round((Date.now() - value) / 60000)); if (minutes < 2) return "Just now"; if (minutes < 60) return `${minutes}m ago`; const hours = Math.round(minutes / 60); return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`; }
