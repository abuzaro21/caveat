// Small presentational pieces shared by the panels.
import type { Decision } from './api.ts';
import { OUTCOME_LABEL, fmtDate } from './api.ts';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo">
      <rect width="64" height="64" rx="16" className="logo-bg" />
      <path d="M19 41 L32 23 L45 41" fill="none" className="logo-caret" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 48 H25 M39 48 H53" className="logo-line" strokeWidth="4" strokeLinecap="round" />
      <circle cx="32" cy="12.5" r="3.6" className="logo-dot" />
    </svg>
  );
}

export function Outcome({ o }: { o: Decision['outcome'] }) {
  return <span className={`outcome outcome-${o.toLowerCase()}`}>{OUTCOME_LABEL[o]}</span>;
}

export function Grade({ g }: { g?: string }) {
  if (!g) return null;
  return <span className={`grade grade-${g}`} title="Evidence grade: a documented category, not a probability">{g}</span>;
}

/** Age of the latest confirmation against the predicate's action and advice horizons. */
export function FreshMeter({ d, compact = false }: { d: Decision; compact?: boolean }) {
  const f = d.freshness; if (!f) return null;
  const max = Math.max(f.adviceHorizonDays * 1.25, f.ageDays * 1.08, 1);
  const pct = (x: number) => `${Math.min(100, (x / max) * 100)}%`;
  return (
    <div className={`fresh ${compact ? 'fresh-compact' : ''}`} aria-label={`Last confirmed ${f.ageDays} days ago. Action horizon ${f.actionHorizonDays} days, advice horizon ${f.adviceHorizonDays} days. State: ${f.state}.`}>
      <div className="fresh-track">
        <span className="zone zone-fresh" style={{ width: pct(f.actionHorizonDays) }} />
        <span className="zone zone-review" style={{ left: pct(f.actionHorizonDays), width: `calc(${pct(f.adviceHorizonDays)} - ${pct(f.actionHorizonDays)})` }} />
        <span className="zone zone-stale" style={{ left: pct(f.adviceHorizonDays), right: 0 }} />
        <span className={`fresh-pin pin-${f.state}`} style={{ left: pct(f.ageDays) }} />
      </div>
      {!compact && (
        <div className="fresh-legend">
          <span>confirmed {fmtDate(f.lastConfirmed)} · <b>{f.ageDays} days</b> ago</span>
          <span>act ≤ {f.actionHorizonDays}d · advise ≤ {f.adviceHorizonDays}d</span>
        </div>
      )}
    </div>
  );
}

export function MightBeWrong({ text }: { text: string }) {
  const lead = 'I might be wrong about this.';
  if (!text.startsWith(lead)) return <p className="sentence">{text}</p>;
  return (
    <p className="sentence">
      <mark className="caveat-mark"><svg className="caret" viewBox="0 0 12 10" width="0.72em" height="0.6em" aria-hidden="true"><path d="M1.5 8.5 L6 1.8 L10.5 8.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>{lead}</mark>{text.slice(lead.length)}
    </p>
  );
}

export function Spinner() { return <span className="spinner" aria-hidden="true" />; }
