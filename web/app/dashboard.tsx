"use client";

import { useEffect, useState } from "react";

type Usage = { checkedAt: number | null; primaryUsedPercent: number | null; secondaryUsedPercent: number | null; primaryResetAt: number | null; secondaryResetAt: number | null; burnRatePerHour: number | null; models: Array<{ name: string; requests: number; tokens: number }>; history: Array<{ label: string; used: number }>; providers: Array<{ name: string; status: string; detail: string }>; source: string; error: string | null };

const empty: Usage = { checkedAt:null, primaryUsedPercent:null, secondaryUsedPercent:null, primaryResetAt:null, secondaryResetAt:null, burnRatePerHour:null, models:[], history:[], providers:[], source:"Not connected", error:null };
const pct = (value:number|null) => value == null ? "—" : `${Math.round(value)}%`;
const when = (value:number|null) => value == null ? "Not available" : new Date(value).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
const compact = (value:number) => value >= 1e6 ? `${(value/1e6).toFixed(1)}M` : value >= 1e3 ? `${(value/1e3).toFixed(1)}K` : `${value}`;

export default function Dashboard({ userName, userEmail, signOut }:{userName:string; userEmail:string; signOut:string}) {
  const [data, setData] = useState<Usage>(empty);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/usage", { cache:"no-store" }).then(r => r.json()).then(setData).catch(() => setData({...empty, error:"The telemetry endpoint could not be reached."})).finally(() => setLoading(false)); }, []);
  const max = Math.max(1, ...data.history.map(item => item.used));
  const primary = data.primaryUsedPercent == null ? null : Math.max(0, 100 - data.primaryUsedPercent);
  const secondary = data.secondaryUsedPercent == null ? null : Math.max(0, 100 - data.secondaryUsedPercent);
  return <main className="shell">
    <header className="topbar"><div className="brand"><div className="mark" /> Codex Pulse</div><div className="user"><span>{userName} · {userEmail}</span><a href={signOut}>Sign out</a></div></header>
    <section className="intro"><div><div className="eyebrow">Private telemetry / personal workspace</div><h1>Your usage, without the guesswork.</h1><p>One calm view of limits, model activity, burn rate, and what your connected providers are doing.</p></div><div className="sync"><span />{loading ? "SYNCING NOW" : `LAST CHECK ${when(data.checkedAt).toUpperCase()}`}</div></section>
    <section className="grid">
      <article className="card metric accent"><div className="eyebrow">Primary window</div><h2 className="metric-value">{pct(primary)}</h2><p>capacity remaining</p></article>
      <article className="card metric"><div className="eyebrow">Weekly window</div><h2>{pct(secondary)}</h2><p>capacity remaining</p></article>
      <article className="card metric"><div className="eyebrow">Burn rate</div><h2>{data.burnRatePerHour == null ? "—" : `${data.burnRatePerHour.toFixed(1)}%`}</h2><p>used per hour</p></article>
      <article className="card metric"><div className="eyebrow">Data source</div><h2>{data.source === "Live" ? "Live" : "—"}</h2><p>{data.source}</p></article>
      <article className="card wide"><div className="card-head"><div><h3>Usage rhythm</h3><p className="sub">Observed primary-limit consumption over the available window</p></div><div className="eyebrow">30 days</div></div>{data.history.length ? <div className="chart">{data.history.map(item => <div className="bar-wrap" key={item.label}><div className="bar" style={{height:`${Math.max(3, item.used/max*100)}%`}} /><span className="bar-label">{item.label}</span></div>)}</div> : <p className="empty" style={{marginTop:28}}>No local history is available to the hosted runtime yet. Live limit data will appear as soon as a server-side Codex source is configured.</p>}</article>
      <article className="card side"><div className="card-head"><div><h3>Reset runway</h3><p className="sub">Next known windows</p></div></div><div className="list"><div className="row"><span>Primary reset</span><strong>{when(data.primaryResetAt)}</strong></div><div className="row"><span>Weekly reset</span><strong>{when(data.secondaryResetAt)}</strong></div></div>{data.burnRatePerHour != null && primary != null && <div className="notice">At the current pace, primary capacity has roughly {Math.max(0, (primary / data.burnRatePerHour)).toFixed(1)} hours of runway remaining.</div>}</article>
      <article className="card wide"><div className="card-head"><div><h3>Model activity</h3><p className="sub">Requests and token volume from connected telemetry</p></div></div>{data.models.length ? <div className="list">{data.models.map(model => <div key={model.name}><div className="row"><span>{model.name}</span><strong>{model.requests} req · {compact(model.tokens)} tokens</strong></div><div className="track"><div className="fill" style={{width:`${Math.min(100, model.requests / Math.max(1, ...data.models.map(m=>m.requests))*100)}%`}} /></div></div>)}</div> : <p className="empty" style={{marginTop:24}}>Model-level rollout logs remain on your desktop by design. Add a server-side telemetry source to populate this panel.</p>}</article>
      <article className="card side"><div className="card-head"><div><h3>Provider health</h3><p className="sub">Connected sources only</p></div></div><div>{data.providers.length ? data.providers.map(provider => <div className="provider" key={provider.name}><span>{provider.name}<small style={{display:"block",color:"var(--muted)",marginTop:4}}>{provider.detail}</small></span><span className={`pill ${provider.status !== "Connected" ? "off" : ""}`}>{provider.status}</span></div>) : <p className="empty" style={{marginTop:24}}>No provider credentials are configured in the hosted runtime.</p>}</div></article>
    </section>
    {data.error && <div className="notice" style={{marginTop:18}}>{data.error}</div>}
    <footer>Private by policy · prompts never leave their source machine · {userEmail}</footer>
  </main>;
}
