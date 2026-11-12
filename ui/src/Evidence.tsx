// The evidence panel: everything behind one decision, in the four questions a person would ask.
import type { Decision, Considered, Trace, Naive } from './api.ts';
import { KIND_LABEL, ROLE_LABEL, fmtDate } from './api.ts';
import { FreshMeter, Grade, MightBeWrong, Outcome } from './parts.tsx';

const NEXT: Record<Decision['next'], string> = {
  proceed: 'Act on it. The evidence is strong, fresh and uncontested.',
  'proceed-with-caveat': 'Answer, but say what could make it wrong. Do not take a consequential action on it.',
  'ask-user': 'Stop and ask. Only you can resolve this, and nothing is booked until you do.',
  stop: 'Say nothing from memory. There is no usable memory for this.',
};

function EvidenceRow({ c }: { c: Considered }) {
  return (
    <li className={`ev ev-${c.role}`}>
      <div className="ev-head">
        <span className={`role role-${c.role}`}>{ROLE_LABEL[c.role]}</span>
        <span className="ev-src">{c.sourceLabel}</span>
        <Grade g={c.grade} />
      </div>
      <blockquote className="ev-quote">{c.excerpt}</blockquote>
      <div className="ev-meta">
        <span>{KIND_LABEL[c.sourceKind]}</span><span>{fmtDate(c.observedAt)}</span><span>scope: {c.scope}</span>
        <span>{c.stance === 'opposes' ? `against ${c.valueLabel}` : c.valueLabel}</span>
      </div>
      <div className="ev-why">{c.why}</div>
    </li>
  );
}

function Compare({ d }: { d: Decision }) {
  const lead = d.considered.find((c) => c.role === 'leader');
  const against = d.considered.filter((c) => c.role === 'conflict');
  if (!lead || !against.length) return null;
  const first = against[against.length - 1], last = against[0];
  return (
    <div className="compare" role="group" aria-label="Conflicting evidence">
      <div className="claim claim-a">
        <div className="claim-tag">Claim A · relied on until now</div>
        <div className="claim-value">{lead.valueLabel}</div>
        <dl>
          <dt>Source</dt><dd>{lead.sourceLabel} — {KIND_LABEL[lead.sourceKind]}</dd>
          <dt>When</dt><dd>{fmtDate(lead.observedAt)}</dd>
          <dt>Scope</dt><dd>{lead.scope}</dd>
          <dt>Grade</dt><dd><Grade g={lead.grade} /></dd>
        </dl>
      </div>
      <div className="versus" aria-hidden="true">vs</div>
      <div className="claim claim-b">
        <div className="claim-tag">Claim B · newer evidence</div>
        <div className="claim-value">not {lead.valueLabel}</div>
        <dl>
          <dt>Source</dt><dd>{first.sourceLabel} — {KIND_LABEL[first.sourceKind]}{against.length > 1 ? ` (${against.length} records)` : ''}</dd>
          <dt>When</dt><dd>{against.length > 1 ? `${fmtDate(first.observedAt)} – ${fmtDate(last.observedAt)}` : fmtDate(first.observedAt)}</dd>
          <dt>Scope</dt><dd>{first.scope}</dd>
          <dt>Grade</dt><dd><Grade g={first.grade} /></dd>
        </dl>
      </div>
      <div className="compare-foot">
        <p><b>Why it matters:</b> {d.purpose === 'action' ? 'the task you asked for depends on this memory; acting on the wrong value fails in the real world.' : 'an answer built on it could mislead you.'}</p>
        <p><b>Allowed resolution:</b> only you can settle your {d.label.toLowerCase()}. {first.sourceLabel} can raise doubt; it cannot establish what you want. Confirm or correct, and the correction supersedes both.</p>
      </div>
    </div>
  );
}

export function decisionTrace(d: Decision): Trace {
  const by = (r: string) => d.considered.filter((c) => c.role === r).length;
  return [
    { step: 'Identity + scope', detail: `subject ${d.subject}, purpose ${d.purpose}, scope ${d.scope}`, ms: 0 },
    { step: 'Consent + revocation filter', detail: d.blockedBy ? `blocked: ${d.blockedBy}` : 'permitted', ms: 0 },
    { step: 'Candidate retrieval', detail: `${d.considered.length} evidence records considered; ${by('out-of-scope')} in another scope or about another person`, ms: 0 },
    { step: 'Freshness + contradiction', detail: `${d.freshness ? `${d.freshness.state}, ${d.freshness.ageDays} days old` : 'n/a'}; conflict ${d.conflict.state}; ${by('corrected')} superseded by a correction`, ms: 0 },
    { step: 'Evidence ranking', detail: d.grade ? `leader graded ${d.grade}` : 'no leader', ms: 0 },
    { step: 'Decision', detail: `${d.outcome}${d.mightBeWrong ? ' — uncertainty is stated' : ''}`, ms: 0 },
  ];
}

export function EvidencePanel({ d, trace, naive, onNaive }: { d: Decision | null; trace: Trace | null; naive: Naive | null; onNaive: () => void }) {
  if (!d) return (
    <section className="panel evidence empty" aria-label="Evidence">
      <div className="empty-art" aria-hidden="true">‸</div>
      <h2>Evidence appears here</h2>
      <p>Ask the assistant something or run a task. Every answer shows which memory it relied on, why, what could make it wrong, and what happens next.</p>
    </section>
  );
  const lead = d.considered.find((c) => c.role === 'leader');
  const t = trace ?? decisionTrace(d);
  return (
    <section className="panel evidence" aria-label="Evidence" aria-live="polite">
      <header className="ev-title">
        <div>
          <div className="eyebrow">Decision · {d.purpose === 'action' ? 'before acting' : d.purpose === 'inspection' ? 'inspection' : 'answering'}</div>
          <h2>{d.label}{d.scope !== 'everywhere' ? <span className="scope-chip">{d.scope}</span> : null}</h2>
        </div>
        <Outcome o={d.outcome} />
      </header>
      <MightBeWrong text={d.sentence} />

      <div className="q-grid">
        <div className="q"><h3>What memory am I relying on?</h3>
          {lead ? <p><b>{d.valueLabel}</b> — {lead.sourceLabel}, {fmtDate(lead.observedAt)}.<br /><span className="muted">“{lead.excerpt}”</span></p> : <p className="muted">None. {d.blockedBy === 'revoked' ? 'You revoked this topic.' : d.blockedBy ? 'Not available for this purpose or person.' : 'Nothing in scope.'}</p>}
        </div>
        <div className="q"><h3>Why do I believe it?</h3>
          {d.grade ? <><p><Grade g={d.grade} /> {d.scopeMatch === 'exact' ? 'exact scope match' : d.scopeMatch === 'general' ? 'general memory (no place given)' : ''}</p><ul className="reasons">{d.gradeReasons.map((r) => <li key={r}>{r}</li>)}</ul></> : <p className="muted">—</p>}
        </div>
        <div className="q"><h3>What could make it wrong?</h3>
          {d.reasons.length ? <ul className="reasons">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="muted">Nothing found: strong, fresh, uncontested.</p>}
          {d.conflict.state !== 'none' && d.conflict.state !== 'contested' && <p className="muted small">{d.conflict.explanation}</p>}
        </div>
        <div className="q"><h3>What should I do next?</h3><p>{NEXT[d.next]}</p></div>
      </div>

      {d.freshness && <div className="block"><h3>Freshness</h3><FreshMeter d={d} /></div>}
      {d.conflict.state === 'contested' && <div className="block"><h3>Conflicting evidence</h3><Compare d={d} /></div>}

      {d.considered.length > 0 && (
        <div className="block"><h3>All evidence considered <span className="count">{d.considered.length}</span></h3>
          <ul className="ev-list">{d.considered.map((c) => <EvidenceRow key={c.id} c={c} />)}</ul>
        </div>
      )}

      <div className="block"><h3>Retrieval trace</h3>
        <ol className="trace">{t.map((s, i) => <li key={i} style={{ animationDelay: `${i * 70}ms` }}><span className="trace-step">{s.step}</span><span className="trace-detail">{s.detail}</span>{trace && <span className="trace-ms">{s.ms.toFixed(2)} ms</span>}</li>)}</ol>
        <p className="muted small">{trace ? 'Measured on the server for this request.' : 'Derived from the server decision for this task.'} Deterministic policy, no language model.</p>
      </div>

      <div className="block naive">
        <h3>Same inputs, naive memory <span className="tag-control">negative control</span></h3>
        {!naive ? <button className="btn ghost" onClick={onNaive}>Show what a naive memory does</button> : (
          <div className="naive-body">
            <p><b>{naive.booking.said}</b> Based on {naive.booking.basedOn}</p>
            <ul className="reasons bad">{naive.booking.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            <p><b>Naive “forget” of {naive.forgetting.label.toLowerCase()}:</b> hidden from the screen, but {naive.forgetting.stillInIndex} index terms remain, it is {naive.forgetting.stillInExport ? 'still in the export' : 'not in the export'}, and an old backup {naive.forgetting.reimportAccepted ? 'brings it straight back' : 'is refused'}.</p>
            <p className="muted small">{naive.note}</p>
          </div>
        )}
      </div>
    </section>
  );
}
