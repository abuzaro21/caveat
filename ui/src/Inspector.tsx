// "What do you remember about me?" — the memory inventory with real correct / forget controls.
import { useState } from 'react';
import type { Memory, Receipt, State } from './api.ts';
import { KIND_LABEL, fmtDate } from './api.ts';
import { FreshMeter, Grade, Outcome } from './parts.tsx';

export type Filter = 'all' | 'active' | 'attention' | 'expired' | 'forgotten';
const STATUS_LABEL: Record<Memory['status'], string> = { active: 'Active', contested: 'Contested', stale: 'Needs review', uncertain: 'Uncertain', expired: 'Expired' };
const OPTIONS: Record<string, { label: string; value: unknown }[]> = {
  'delivery.window': [{ label: 'Mornings', value: 'morning' }, { label: 'Afternoons', value: 'afternoon' }, { label: 'Evenings', value: 'evening' }],
  'work.office_days': [{ label: 'Mon & Wed', value: ['mon', 'wed'] }, { label: 'Tue & Thu', value: ['tue', 'thu'] }, { label: 'Mon – Fri', value: ['mon', 'tue', 'wed', 'thu', 'fri'] }],
  'home.city': [{ label: 'Porto', value: 'Porto' }, { label: 'Lisbon', value: 'Lisbon' }],
};
export const optionsFor = (p: string) => OPTIONS[p] ?? [];

function Card({ m, onFocus, onCorrect, onForget, busy }: { m: Memory; onFocus: () => void; onCorrect: (v: unknown) => void; onForget: () => void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const d = m.decision;
  const lead = d.considered.find((c) => c.role === 'leader');
  const opts = optionsFor(m.predicate);
  return (
    <article className={`mem mem-${m.status}`} data-predicate={m.predicate} data-scope={m.scopeKey}>
      <header className="mem-head">
        <div>
          <div className="mem-label">{m.policy.label}{m.scopeKey && <span className="scope-chip">{m.scopeKey.replace('place=', '')}</span>}{m.policy.sensitive && <span className="sensitive">sensitive</span>}</div>
          <div className="mem-value">{d.valueLabel ?? <span className="muted">—</span>}</div>
        </div>
        <span className={`status status-${m.status}`}>{STATUS_LABEL[m.status]}</span>
      </header>
      {lead && <p className="mem-src">{lead.sourceLabel} · {KIND_LABEL[lead.sourceKind]} · <Grade g={d.grade} /></p>}
      {d.freshness ? <FreshMeter d={d} compact /> : null}
      <dl className="mem-facts">
        <dt>Last confirmed</dt><dd>{d.freshness ? `${fmtDate(d.freshness.lastConfirmed)} (${d.freshness.ageDays} d)` : m.status === 'expired' ? 'applies to another time' : '—'}</dd>
        <dt>To act on it</dt><dd><Outcome o={m.actionOutcome} /></dd>
        <dt>Why it expires</dt><dd>{m.policy.why}</dd>
        <dt>Used in</dt><dd>{m.usedIn.length ? m.usedIn.map((u) => `${u.task} (${fmtDate(u.at)})`).join('; ') : 'not used yet'}</dd>
        {m.policy.sensitive && <><dt>Consent</dt><dd>only for {m.policy.consentedPurposes.join(', ')}; never shared with the household</dd></>}
      </dl>
      <div className="mem-actions">
        <button className="btn ghost sm" onClick={onFocus}>Inspect evidence</button>
        {opts.length > 0 && <button className="btn ghost sm" onClick={() => setEditing((x) => !x)} aria-expanded={editing}>Correct</button>}
        <button className="btn danger sm" onClick={onForget} disabled={busy}>Forget</button>
      </div>
      {editing && (
        <div className="mem-edit" role="group" aria-label={`Correct ${m.policy.label}`}>
          {opts.map((o) => <button key={o.label} className="btn chip" disabled={busy} onClick={() => { setEditing(false); onCorrect(o.value); }}>{o.label}</button>)}
        </div>
      )}
    </article>
  );
}

function ReceiptCard({ r, onOpen }: { r: Receipt; onOpen: () => void }) {
  const passed = r.verification.filter((v) => v.pass).length;
  return (
    <article className="mem mem-forgotten">
      <header className="mem-head">
        <div><div className="mem-label">{r.kind === 'retention' ? 'Retention expiry' : 'Forgotten'}</div><div className="mem-value">{r.request.topic}</div></div>
        <span className={`status ${r.verified ? 'status-verified' : 'status-contested'}`}>{r.verified ? 'Verified' : 'Check failed'}</span>
      </header>
      <p className="mem-src">{r.request.mode} · {fmtDate(r.at)}</p>
      <p className="small">Deleted {r.deleted.evidence} record{r.deleted.evidence === 1 ? '' : 's'}, {r.deleted.indexEntries} index entr{r.deleted.indexEntries === 1 ? 'y' : 'ies'}{r.verification.length ? ` · ${passed}/${r.verification.length} checks passed` : ''}</p>
      <div className="mem-actions"><button className="btn ghost sm" onClick={onOpen}>Open receipt</button></div>
    </article>
  );
}

export function Inspector({ state, filter, setFilter, onFocus, onCorrect, onForget, onReceipt, busy }: {
  state: State; filter: Filter; setFilter: (f: Filter) => void; onFocus: (m: Memory) => void; onCorrect: (m: Memory, v: unknown) => void;
  onForget: (m: Memory) => void; onReceipt: (r: Receipt) => void; busy: boolean;
}) {
  const ms = state.memories;
  const counts: Record<Filter, number> = {
    all: ms.length, active: ms.filter((m) => m.status === 'active').length,
    attention: ms.filter((m) => ['contested', 'stale', 'uncertain'].includes(m.status)).length,
    expired: ms.filter((m) => m.status === 'expired').length, forgotten: state.receipts.length,
  };
  const shown = filter === 'all' ? ms : filter === 'active' ? ms.filter((m) => m.status === 'active') : filter === 'attention' ? ms.filter((m) => ['contested', 'stale', 'uncertain'].includes(m.status)) : filter === 'expired' ? ms.filter((m) => m.status === 'expired') : [];
  return (
    <section className="panel inspector" aria-label="Memory inspector">
      <header className="panel-head">
        <div><div className="eyebrow">Memory inspector</div><h2>What I remember about you</h2></div>
      </header>
      <div className="filters" role="tablist" aria-label="Filter memories">
        {(['all', 'active', 'attention', 'expired', 'forgotten'] as Filter[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`filter ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {{ all: 'All', active: 'Active', attention: 'Uncertain', expired: 'Expired', forgotten: 'Forgotten' }[f]} <span>{counts[f]}</span>
          </button>
        ))}
      </div>
      <div className="mem-list">
        {filter === 'forgotten'
          ? (state.receipts.length ? state.receipts.map((r) => <ReceiptCard key={r.id} r={r} onOpen={() => onReceipt(r)} />) : <p className="muted pad">Nothing forgotten yet. Receipts for forgetting and scheduled retention appear here.</p>)
          : shown.map((m) => <Card key={m.key} m={m} busy={busy} onFocus={() => onFocus(m)} onCorrect={(v) => onCorrect(m, v)} onForget={() => onForget(m)} />)}
        {filter !== 'forgotten' && shown.length === 0 && <p className="muted pad">No memories in this view.</p>}
      </div>
      <footer className="inspector-foot">
        <p className="small muted">{state.otherPeople} memor{state.otherPeople === 1 ? 'y' : 'ies'} about another household member (Sam) exist{state.otherPeople === 1 ? 's' : ''} and {state.otherPeople === 1 ? 'is' : 'are'} not shown: only the person a memory is about can inspect it.</p>
      </footer>
    </section>
  );
}
