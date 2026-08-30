"use client";

import { useMemo, useState } from "react";

type WindowKey = "week" | "all";
type Leader = {
  handle: string;
  name: string;
  accent: string;
  spend: number;
  weeklySpend: number;
  tokens: number;
  weeklyTokens: number;
  activeDays: number;
  lastActive: string;
};

const leaders: Leader[] = [
  { handle: "kernelknight", name: "Mara K.", accent: "MK", spend: 412568, weeklySpend: 4825, tokens: 631170000000, weeklyTokens: 8020000000, activeDays: 322, lastActive: "Today" },
  { handle: "shipshape", name: "Theo R.", accent: "TR", spend: 298741, weeklySpend: 4194, tokens: 267930000000, weeklyTokens: 7110000000, activeDays: 185, lastActive: "Today" },
  { handle: "infrawizard", name: "Nia A.", accent: "NA", spend: 275380, weeklySpend: 3852, tokens: 243680000000, weeklyTokens: 6680000000, activeDays: 204, lastActive: "Today" },
  { handle: "datamystic", name: "Ravi S.", accent: "RS", spend: 251489, weeklySpend: 3122, tokens: 222150000000, weeklyTokens: 5210000000, activeDays: 190, lastActive: "Yesterday" },
  { handle: "potaotpilot", name: "Em J.", accent: "EJ", spend: 229175, weeklySpend: 2948, tokens: 198460000000, weeklyTokens: 4870000000, activeDays: 168, lastActive: "Today" },
  { handle: "catbyte", name: "Sofia L.", accent: "SL", spend: 214532, weeklySpend: 2681, tokens: 187030000000, weeklyTokens: 4490000000, activeDays: 231, lastActive: "Today" },
  { handle: "ironprompt", name: "Cal W.", accent: "CW", spend: 203914, weeklySpend: 2386, tokens: 173110000000, weeklyTokens: 4010000000, activeDays: 199, lastActive: "2 days ago" },
  { handle: "debugbear", name: "Inez F.", accent: "IF", spend: 187863, weeklySpend: 2194, tokens: 163570000000, weeklyTokens: 3890000000, activeDays: 176, lastActive: "Today" },
  { handle: "shadowdebug", name: "Owen B.", accent: "OB", spend: 176320, weeklySpend: 2045, tokens: 148720000000, weeklyTokens: 3510000000, activeDays: 151, lastActive: "Yesterday" },
  { handle: "silentloop", name: "Aya D.", accent: "AD", spend: 159872, weeklySpend: 1896, tokens: 133540000000, weeklyTokens: 3290000000, activeDays: 210, lastActive: "Today" },
];

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function Leaderboard({ userName, signOut }: { userName: string; signOut: string }) {
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [metric, setMetric] = useState<"tokens" | "spend">("tokens");

  const ranked = useMemo(() => [...leaders].sort((a, b) => {
    const key = windowKey === "week"
      ? metric === "tokens" ? "weeklyTokens" : "weeklySpend"
      : metric;
    return Number(b[key]) - Number(a[key]);
  }), [metric, windowKey]);

  return <main className="leader-shell">
    <header className="leader-topbar">
      <a className="brand" href="/"><span className="mark" /> Codex Pulse</a>
      <nav className="leader-nav" aria-label="Primary navigation">
        <a href="/">My usage</a>
        <span className="active">Leaderboard</span>
      </nav>
      <div className="leader-user"><span>{userName}</span><a href={signOut}>Sign out</a></div>
    </header>

    <section className="leader-hero">
      <div>
        <div className="eyebrow">Community / opt-in preview</div>
        <h1>Who is pushing<br />Codex the furthest?</h1>
      </div>
      <p>Compare aggregate usage without exposing prompts, code, or session history. Every future live entry will be opt-in and independently revocable.</p>
    </section>

    <section className="record-grid" aria-label="Community records">
      <article className="record lime-record"><span>Longest single session</span><strong>18h 42m</strong><small>kernelknight · preview</small></article>
      <article className="record"><span>Fastest plan burn</span><strong>3h 19m</strong><small>shipshape · preview</small></article>
      <article className="record"><span>Most active days</span><strong>322</strong><small>kernelknight · preview</small></article>
    </section>

    <section className="leader-card">
      <div className="leader-card-head">
        <div><div className="preview-pill">Preview data</div><h2>Global leaderboard</h2><p>Numbers below demonstrate the experience; they are not real user totals.</p></div>
        <div className="leader-controls" aria-label="Leaderboard filters">
          <div className="segmented">
            <button className={metric === "tokens" ? "selected" : ""} onClick={() => setMetric("tokens")}>Tokens</button>
            <button className={metric === "spend" ? "selected" : ""} onClick={() => setMetric("spend")}>Spend</button>
          </div>
          <div className="segmented">
            <button className={windowKey === "week" ? "selected" : ""} onClick={() => setWindowKey("week")}>7 days</button>
            <button className={windowKey === "all" ? "selected" : ""} onClick={() => setWindowKey("all")}>All time</button>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Builder</th><th>Est. spend</th><th>Tokens</th><th>Active days</th><th>Last active</th></tr></thead>
          <tbody>{ranked.map((leader, index) => <tr key={leader.handle}>
            <td><span className={`rank rank-${index + 1}`}>{index + 1}</span></td>
            <td><div className="builder"><span className="avatar">{leader.accent}</span><span><strong>{leader.handle}</strong><small>{leader.name}</small></span></div></td>
            <td>{money.format(windowKey === "week" ? leader.weeklySpend : leader.spend)}</td>
            <td>{compact.format(windowKey === "week" ? leader.weeklyTokens : leader.tokens)}</td>
            <td>{leader.activeDays}</td>
            <td>{leader.lastActive}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="verification">
      <div><div className="eyebrow">Privacy boundary</div><h2>Only the totals leave your device.</h2></div>
      <div className="verification-steps">
        <p><span>01</span><strong>You opt in</strong> from the desktop app.</p>
        <p><span>02</span><strong>Pulse signs aggregates</strong> such as token totals, active days, and plan-burn duration.</p>
        <p><span>03</span><strong>You can leave anytime</strong> and remove the public entry without deleting local history.</p>
      </div>
    </section>
    <footer>Codex Pulse community preview · private by default</footer>
  </main>;
}
