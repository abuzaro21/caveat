// CAVEAT — the assistant, the evidence behind each decision, and the memory inspector, side by side.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AskResult, Booking, Decision, Memory, Naive, Plan, Receipt, State, Trace } from './api.ts';
import { ApiError, api, fmtDate, fmtDay } from './api.ts';
import { EvidencePanel } from './Evidence.tsx';
import { ForgetDialog, type Proof } from './Forget.tsx';
import { Inspector, optionsFor, type Filter } from './Inspector.tsx';
import { Logo, MightBeWrong, Outcome, Spinner } from './parts.tsx';

type Msg = {
  id: number; who: 'you' | 'caveat' | 'system'; text: string; redacted?: boolean;
  decision?: Decision; trace?: Trace; ask?: { decision: Decision; task?: string }; booking?: Booking; plan?: Plan;
};
type Tab = 'assistant' | 'evidence' | 'memory';
type Done = Record<string, boolean>;

const TASK_LABEL: Record<string, string> = { 'sofa-home': 'Book the sofa delivery to home', 'repair-office': 'Send the laptop repair to the office' };
const PROBE: Record<string, string> = {
  'location.private': 'Where am I on Friday afternoon?', 'delivery.window': 'When should deliveries come to my home?',
  'work.office_days': 'Which days am I in the office?', 'home.city': 'Which city do I live in?', 'delivery.hold': 'Is there a hold on my deliveries?',
};
const SUGGESTIONS = ['When should deliveries come to my home?', 'Which days am I in the office?', 'Where am I on Friday afternoon?', 'What do you remember about me?'];
const COMMON = new Set(['mornings', 'afternoons', 'evenings', 'morning', 'afternoon', 'evening', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'fridays', 'confirmed', 'correction', 'delivery', 'deliveries', 'window', 'from', 'with', 'that', 'this', 'there', 'your', 'have', 'about', 'office', 'home']);
const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));

/** Words that only the doomed memory contains: a secondary check in the proofs (the exact phrases below are primary). */
function markersOf(target: Memory, state: State): string[] {
  const mine = new Set<string>();
  for (const c of target.decision.considered) if (c.role !== 'out-of-scope') { words(c.excerpt).forEach((w) => mine.add(w)); words(c.valueLabel).forEach((w) => mine.add(w)); }
  // Anything that also appears elsewhere in the session (other memories, their sources, receipts, the audit) is vocabulary, not this memory.
  const rest = { ...state, memories: state.memories.filter((m) => m.predicate !== target.predicate), bookings: [], summary: null };
  const others = new Set(words(JSON.stringify(rest)));
  return [...mine].filter((w) => !others.has(w) && !COMMON.has(w));
}
/** The memory's own text, verbatim: every value label and excerpt behind it, checked as whole phrases. */
function contentOf(target: Memory): string[] {
  const out = new Set<string>();
  const add = (t: unknown) => { if (typeof t === 'string' && t.trim().length >= 3) out.add(JSON.stringify(t.trim().toLowerCase()).slice(1, -1)); };
  for (const c of target.decision.considered) if (c.role !== 'out-of-scope') { add(c.excerpt); add(c.valueLabel); }
  const v = target.decision.value as { label?: unknown } | null | undefined;
  if (v && typeof v === 'object') add(v.label);
  return [...out];
}
type Needles = { content: string[]; markers: string[] };
const leaks = (x: unknown, n: Needles) => { const t = JSON.stringify(x ?? null).toLowerCase(); return [...n.content, ...n.markers].filter((m) => t.includes(m)); };
const describe = (l: string[]) => l.map((w) => (w.length > 24 ? `${w.slice(0, 24)}…` : w)).join(', ');

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [focus, setFocus] = useState<{ d: Decision; trace: Trace | null } | null>(null);
  const [naive, setNaive] = useState<Naive | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('assistant');
  const [input, setInput] = useState('');
  const [done, setDone] = useState<Done>({});
  const [forgetTarget, setForgetTarget] = useState<Memory | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [backup, setBackup] = useState<{ envelope: unknown; items: number } | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('caveat-theme') as 'light') || 'dark'; } catch { return 'dark'; } });
  const markersRef = useRef<Needles>({ content: [], markers: [] });
  // Mirrors of what this page holds, so the page proof reads live state rather than a stale closure.
  const heldRef = useRef<{ msgs: Msg[]; focus: unknown; naive: unknown }>({ msgs: [], focus: null, naive: null });
  heldRef.current = { msgs, focus, naive };
  const nextId = useRef(1);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('caveat-theme', theme); } catch { /* storage unavailable */ } }, [theme]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  const push = useCallback((m: Omit<Msg, 'id'>) => setMsgs((xs) => [...xs, { ...m, id: nextId.current++ }]), []);
  const refresh = useCallback(async () => { const s = await api.state(); setState(s); return s; }, []);
  const mark = (k: string) => setDone((d) => ({ ...d, [k]: true }));

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setErr(null);
    try { return await fn(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); return undefined; }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    run(async () => {
      const s = await api.session(); setState(s);
      push({ who: 'caveat', text: 'Hi Maya. I am your household assistant. I keep memories with their source, strength, freshness and scope, and I tell you when I might be wrong. Everything here is fictional and private to this browser session.' });
    });
  }, [run, push]);

  const showDecision = (d: Decision, trace: Trace | null = null) => { setFocus({ d, trace }); };

  async function ask(text: string) {
    const t = text.trim(); if (!t) return;
    setInput('');
    push({ who: 'you', text: t });
    const r = await run(() => api.ask(t)) as AskResult | undefined; if (!r) return;
    const d = r.decisions[0];
    push({ who: 'caveat', text: r.reply, decision: r.inventory ? undefined : d, trace: r.trace });
    if (r.inventory) { setFilter('all'); setTab('memory'); }
    if (d && !r.inventory) showDecision(d, r.trace);
    if (/deliver/i.test(t)) mark('a1');
    await refresh();
  }

  async function task(id: string) {
    push({ who: 'you', text: TASK_LABEL[id] });
    const r = await run(() => api.book(id)); if (!r) return;
    if (r.ok) {
      const b = r.booking;
      push({ who: 'caveat', text: `Booked: ${fmtDay(b.start)}, ${b.window}, at ${b.place}.`, booking: b, plan: r.plan ?? undefined });
      if (r.plan) showDecision(r.plan.decisions[0]);
      if (id === 'sofa-home') mark('a3'); else mark('b3');
    } else {
      const d = r.plan.blockedBy!;
      push({ who: 'caveat', text: d.sentence, decision: d, ask: { decision: d, task: id }, plan: r.plan });
      showDecision(d);
      if (id === 'sofa-home') mark('a2'); else if (d.freshness?.state !== 'fresh') mark('b2');
    }
    await refresh();
  }

  async function answer(d: Decision, value: unknown, label: string, retry?: string) {
    push({ who: 'you', text: label });
    const place = d.scope === 'home' || d.scope === 'office' ? d.scope : undefined;
    const r = await run(() => api.answer(d.predicate, value, place)); if (!r) return;
    if (r.result.status === 'rejected') { push({ who: 'system', text: `Not recorded: ${r.result.reason}.` }); return; }
    push({ who: 'system', text: r.kind === 'corrected' ? `Recorded as an explicit correction. It supersedes every earlier record about ${d.label.toLowerCase()}${place ? ` at ${place}` : ''}.` : `Reconfirmed. The memory is fresh again; nothing else changed.` });
    if (retry) await task(retry); else await refresh();
  }

  async function correct(m: Memory, value: unknown) {
    const label = optionsFor(m.predicate).find((o) => JSON.stringify(o.value) === JSON.stringify(value))?.label ?? String(value);
    await answer(m.decision, value, `${m.policy.label}: ${label}`);
  }

  async function advance(days: number) {
    const r = await run(() => api.advance(days)); if (!r) return;
    push({ who: 'system', text: `Virtual clock moved ${days} days forward, to ${fmtDate(r.clock)}.` });
    if (r.retention) push({ who: 'system', text: `Scheduled retention ran: ${r.retention.deleted.evidence} delivery-log and third-party record(s) older than 60 days were deleted, with receipt ${r.retention.id}.` });
    if (days >= 30) mark('b1');
    const s = await refresh();
    if (focus) { const m = s.memories.find((x) => x.predicate === focus.d.predicate && (x.decision.scope === focus.d.scope)); if (m) showDecision(m.decision); }
  }

  async function reset() {
    const s = await run(() => api.reset()); if (!s) return;
    setState(s); setMsgs([]); setFocus(null); setNaive(null); setDone({}); setReceipt(null); setProofs([]); setBackup(null); markersRef.current = { content: [], markers: [] };
    push({ who: 'caveat', text: 'Fresh start: a new isolated session with the original fictional memories. The old session and everything in it were deleted.' });
  }

  async function confirmForget(mode: 'block' | 'before') {
    const target = forgetTarget; if (!target || !state) return;
    const markers = markersOf(target, state);
    const content = contentOf(target);
    const r = await run(async () => {
      // Make the two copies that forgetting usually misses: a backup outside CAVEAT, and a job that already read the memory.
      const env = await api.exportEnvelope();
      await api.queueWorker();
      const rec = await api.forget(target.predicate, mode);
      return { env, rec };
    });
    if (!r) return;
    // The receipt is content-free by design: any word it shares with the memory is fixed vocabulary.
    const receiptWords = new Set(words(JSON.stringify(r.rec)));
    markersRef.current = { content, markers: markers.filter((w) => !receiptWords.has(w)) };
    setBackup({ envelope: r.env, items: (r.env as { items: unknown[] }).items.length });
    setForgetTarget(null); setReceipt(r.rec);
    setProofs([
      { id: 'ask', label: `Ask again: “${PROBE[target.predicate]}”`, status: 'pending' },
      { id: 'reload', label: 'Cold reload: drop every cache and rebuild from storage', status: 'pending' },
      { id: 'export', label: 'Export now: the new export must not contain it', status: 'pending' },
      { id: 'import', label: 'Restore the old backup taken before the forget', status: 'pending' },
      { id: 'worker', label: 'Release the delayed job queued before the forget', status: 'pending' },
      { id: 'page', label: 'This page: nothing shown or held in this tab still quotes it', status: 'pending' },
    ]);
    // The page forgets too. Any earlier message, card or panel may have quoted the memory or been shaped by it, so the
    // transcript, the focused evidence and the naive panel are dropped whole rather than redacted word by word.
    setMsgs([]); setFocus(null); setNaive(null);
    push({ who: 'system', text: 'I cleared this conversation and the evidence panel: earlier messages may have quoted or relied on the memory you asked me to forget.' });
    push({ who: 'system', text: `Forgotten: ${r.rec.request.topic}. Receipt ${r.rec.id}, ${r.rec.verification.filter((v) => v.pass).length}/${r.rec.verification.length} verification checks passed.` });
    if (target.predicate === 'location.private') mark('c1');
    await refresh();
  }

  async function prove() {
    if (!receipt) return;
    const markers = markersRef.current;
    const predicate = state?.tombstones.find((t) => t.topic === receipt.request.topic)?.predicate ?? 'location.private';
    const set = (id: string, p: Partial<Proof>) => setProofs((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const step = async (id: string, fn: () => Promise<{ pass: boolean; detail: string }>) => {
      set(id, { status: 'running', detail: undefined });
      try { const r = await fn(); set(id, { status: r.pass ? 'pass' : 'fail', detail: r.detail }); }
      catch (e) { set(id, { status: 'fail', detail: e instanceof ApiError ? e.message : 'request failed' }); }
    };
    setBusy(true);
    try {
      await step('ask', async () => {
        const a = await api.ask(PROBE[predicate] ?? 'What do you remember about me?');
        const l = leaks(a, markers);
        return { pass: l.length === 0, detail: l.length ? `leaked: ${describe(l)}` : `“${a.reply}”` };
      });
      await step('reload', async () => {
        const r = await api.reload(); const l = leaks(r.state, markers);
        setState(r.state);
        return { pass: l.length === 0, detail: `${r.cacheEntriesDropped} cached decision(s) dropped; rebuilt state ${l.length ? `leaked: ${describe(l)}` : 'has no trace of it'}` };
      });
      await step('export', async () => {
        const e = await api.exportEnvelope(); const l = leaks(e, markers);
        return { pass: l.length === 0, detail: `${(e as { items: unknown[] }).items.length} records exported, ${l.length ? `leaked: ${describe(l)}` : 'none about it'}` };
      });
      await step('import', async () => {
        if (!backup) return { pass: false, detail: 'no backup was taken' };
        const r = await api.importEnvelope(backup.envelope);
        setBackup(null); // the tab's copy has served its purpose; keeping it would be keeping the memory
        const s = await api.state(); setState(s);
        const rejected = r.results.filter((x) => x.status === 'rejected');
        const l = leaks(s, markers);
        const why = [...new Set(rejected.map((x) => x.reason))].join('; ');
        return { pass: l.length === 0, detail: `${r.signed ? 'signed backup' : 'unsigned backup'}: ${rejected.length} record(s) refused${why ? ` (${why})` : ''}, ${r.results.filter((x) => x.status === 'duplicate').length} unchanged; ${l.length ? `leaked: ${describe(l)}` : 'nothing came back'}. The tab's copy is now discarded.` };
      });
      await step('worker', async () => {
        try {
          const w = await api.releaseWorker(); const s = await api.state(); setState(s); const l = leaks(s, markers);
          return { pass: !w.written && l.length === 0, detail: w.reason };
        } catch (e) { if (e instanceof ApiError && e.status === 404) return { pass: true, detail: 'the job was already released and fenced' }; throw e; }
      });
      await step('page', async () => {
        if (!markers.content.length) return { pass: false, detail: 'nothing to check against: the memory had no text to look for' };
        const held = heldRef.current;
        const l = leaks({ msgs: held.msgs, focus: held.focus, naive: held.naive }, markers);
        return { pass: l.length === 0, detail: `${held.msgs.length} message(s), the evidence panel and the naive panel searched for ${markers.content.length} exact phrase(s) and ${markers.markers.length} distinctive word(s): ${l.length ? `still shown: ${describe(l)}` : 'none found'}` };
      });
      if (predicate === 'location.private') mark('c2');
    } finally { setBusy(false); }
  }

  const loadNaive = async () => { const n = await run(() => api.naive()); if (n) setNaive(n); };
  const openForget = (m: Memory) => { setReceipt(null); setForgetTarget(m); };
  const privateMem = state?.memories.find((m) => m.predicate === 'location.private');

  const guide = useMemo(() => [
    { k: 'A', title: 'Conflicting preference', steps: [
      { id: 'a1', label: 'Ask about deliveries', act: () => ask('When should deliveries come to my home?') },
      { id: 'a2', label: 'Book the sofa', act: () => task('sofa-home') },
      { id: 'a3', label: 'Answer the question it asks', hint: 'Choose any window in the card' },
    ] },
    { k: 'B', title: 'Stale memory', steps: [
      { id: 'b1', label: 'Jump 30 days ahead', act: () => advance(30) },
      { id: 'b2', label: 'Send the repair to the office', act: () => task('repair-office') },
      { id: 'b3', label: 'Reconfirm or correct', hint: 'Choose in the card' },
    ] },
    { k: 'C', title: 'Forget, then prove it', steps: [
      { id: 'c1', label: 'Forget the private location', act: () => privateMem ? openForget(privateMem) : undefined, disabled: !privateMem },
      { id: 'c2', label: 'Run the proofs', act: () => { if (receipt) prove(); }, disabled: !receipt },
    ] },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [privateMem, receipt, state, backup, focus]);

  if (!state) return (
    <div className="boot"><Logo size={56} /><p>{err ?? 'Opening a private session…'}</p>{err && <button className="btn primary" onClick={() => location.reload()}>Retry</button>}</div>
  );

  const modal = !!(forgetTarget || receipt);
  return (
    <div className="app">
      <div className="app-body" inert={modal}>
      <header className="top">
        <div className="brand"><Logo size={34} /><div><div className="wordmark">CAVEAT</div><div className="tagline">Remember with reasons. Forget with proof.</div></div></div>
        <div className="clock" aria-live="polite">
          <span className="clock-label">Virtual date</span><b>{fmtDay(state.clock)}</b>
          <div className="clock-btns">
            <button className="btn ghost sm" onClick={() => advance(30)} disabled={busy}>+30 days</button>
            <button className="btn ghost sm" onClick={() => advance(90)} disabled={busy}>+90 days</button>
          </div>
        </div>
        <div className="top-actions">
          <button className="btn ghost sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? '☀' : '☾'}</button>
          <button className="btn ghost sm" onClick={reset} disabled={busy}>Reset demo</button>
        </div>
      </header>

      <nav className="guide" aria-label="Guided demo">
        {guide.map((g) => (
          <div className="guide-group" key={g.k}>
            <div className="guide-title"><span className="guide-k">{g.k}</span>{g.title}</div>
            <ol>
              {g.steps.map((s) => (
                <li key={s.id} className={done[s.id] ? 'done' : ''}>
                  {'act' in s && s.act ? <button className="guide-step" onClick={() => s.act!()} disabled={busy || ('disabled' in s && s.disabled)}><span className="tick" aria-hidden="true">{done[s.id] ? '✓' : ''}</span>{s.label}</button>
                    : <span className="guide-step static"><span className="tick" aria-hidden="true">{done[s.id] ? '✓' : ''}</span>{s.label}<em>{'hint' in s ? s.hint : ''}</em></span>}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </nav>

      {err && <div className="error" role="alert">{err}<button className="btn ghost sm" onClick={() => setErr(null)}>Dismiss</button></div>}

      <div className="tabs" role="tablist" aria-label="Panels">
        {(['assistant', 'evidence', 'memory'] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ assistant: 'Assistant', evidence: 'Evidence', memory: 'Memory' }[t]}</button>)}
      </div>

      <main className="grid">
        <section className={`panel assistant ${tab === 'assistant' ? 'show' : ''}`} aria-label="Assistant">
          <header className="panel-head"><div><div className="eyebrow">Household assistant</div><h2>Talking to Maya</h2></div>{busy && <Spinner />}</header>
          <div className="chat" aria-live="polite">
            {msgs.map((m) => (
              <div key={m.id} className={`msg msg-${m.who} ${m.redacted ? 'redacted' : ''}`}>
                {m.who === 'caveat' && !m.redacted ? <MightBeWrong text={m.text} /> : <p>{m.text}</p>}
                {m.decision && !m.ask && <button className="msg-link" onClick={() => { showDecision(m.decision!, m.trace ?? null); setTab('evidence'); }}><Outcome o={m.decision.outcome} /> Why? See the evidence</button>}
                {m.ask && <AskCard d={m.ask.decision} plan={m.plan} busy={busy} onPick={(v, l) => answer(m.ask!.decision, v, l, m.ask!.task)} onWhy={() => { showDecision(m.ask!.decision); setTab('evidence'); }} />}
                {m.booking && <BookingCard b={m.booking} plan={m.plan} />}
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <div className="tasks">
            <span className="eyebrow">Tasks with consequences</span>
            <div className="task-btns">
              <button className="btn primary" onClick={() => task('sofa-home')} disabled={busy}>Book sofa delivery · home</button>
              <button className="btn primary" onClick={() => task('repair-office')} disabled={busy}>Send laptop repair · office</button>
            </div>
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <div className="suggest">{SUGGESTIONS.map((s) => <button type="button" key={s} className="btn chip" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
            <div className="composer-row">
              <label className="sr-only" htmlFor="q">Ask the assistant</label>
              <input id="q" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about deliveries, office days, Friday…" maxLength={300} autoComplete="off" />
              <button className="btn primary" type="submit" disabled={busy || !input.trim()}>Ask</button>
            </div>
          </form>
        </section>

        <div className={`col-evidence ${tab === 'evidence' ? 'show' : ''}`}>
          <EvidencePanel d={focus?.d ?? null} trace={focus?.trace ?? null} naive={naive} onNaive={loadNaive} />
        </div>

        <div className={`col-memory ${tab === 'memory' ? 'show' : ''}`}>
          <Inspector state={state} filter={filter} setFilter={setFilter} busy={busy}
            onFocus={(m) => { showDecision(m.decision); setTab('evidence'); }}
            onCorrect={correct} onForget={openForget} onReceipt={(r) => { setForgetTarget(null); setReceipt(r); }} />
          <Ledger state={state} />
        </div>
      </main>

      <footer className="foot">
        <span>Fictional data only · one isolated session per visitor · deterministic policy, no language model</span>
        <span>Session revision {state.revision}</span>
      </footer>
      </div>

      <ForgetDialog target={forgetTarget} receipt={receipt} proofs={proofs} backupItems={backup?.items ?? null} busy={busy}
        onConfirm={confirmForget} onClose={() => { setForgetTarget(null); setReceipt(null); }} onProve={prove} />
    </div>
  );
}

function AskCard({ d, plan, busy, onPick, onWhy }: { d: Decision; plan?: Plan; busy: boolean; onPick: (v: unknown, label: string) => void; onWhy: () => void }) {
  const opts = optionsFor(d.predicate);
  const current = opts.find((o) => JSON.stringify(o.value) === JSON.stringify(d.value));
  return (
    <div className={`ask-card ask-${d.outcome.toLowerCase()}`}>
      <div className="ask-head"><Outcome o={d.outcome} /><span>Nothing was booked{plan ? ` — ${plan.label.toLowerCase()} is waiting on this` : ''}.</span></div>
      {d.outcome === 'ASK' && opts.length > 0 && (
        <>
          <p className="ask-q">{d.freshness?.state === 'stale' || d.freshness?.state === 'review-due' ? `Is this still right: ${d.label.toLowerCase()}${d.scope !== 'everywhere' ? ` at ${d.scope}` : ''}?` : `Which is right for ${d.label.toLowerCase()}${d.scope !== 'everywhere' ? ` at ${d.scope}` : ''}?`}</p>
          <div className="ask-opts">
            {current && <button className="btn primary sm" disabled={busy} onClick={() => onPick(current.value, `Yes — still ${current.label.toLowerCase()}`)}>Yes, still {current.label.toLowerCase()}</button>}
            {opts.filter((o) => o !== current).map((o) => <button key={o.label} className="btn chip" disabled={busy} onClick={() => onPick(o.value, o.label)}>{o.label}</button>)}
          </div>
        </>
      )}
      {d.outcome === 'ABSTAIN' && <p className="ask-q">I will not guess. {d.blockedBy === 'revoked' ? 'You asked me to forget this.' : 'There is no memory I may use for this.'}</p>}
      <button className="msg-link" onClick={onWhy}>Why? See the evidence</button>
    </div>
  );
}

function BookingCard({ b, plan }: { b: Booking; plan?: Plan }) {
  return (
    <div className="booking">
      <div className="booking-when"><span>{fmtDay(b.start)}</span><b>{b.window}</b><span>{b.place}</span></div>
      <p className="small">{b.reason}</p>
      {plan?.privacy.used && <p className="small privacy">{plan.privacy.note}</p>}
    </div>
  );
}

function Ledger({ state }: { state: State }) {
  const c = state.counts;
  return (
    <section className="panel ledger" aria-label="Storage and audit">
      <h3>Storage, right now</h3>
      <div className="counts">{Object.entries(c).map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}</div>
      {state.summary && <><h3>Derived summary <span className="count">rev {state.summary.revision}</span></h3><p className="small summary">{state.summary.text}</p></>}
      {state.tombstones.length > 0 && <><h3>Tombstones</h3><ul className="small tombs">{state.tombstones.map((t) => <li key={t.predicate}><b>{t.topic}</b> · {t.mode === 'block' ? 'never relearn' : `nothing from before ${fmtDate(t.revokedAt)}`} · no value stored</li>)}</ul></>}
      <h3>Audit tail</h3>
      <ol className="audit">{state.audit.slice(-6).reverse().map((a) => <li key={a.seq}><span className="mono">#{a.seq}</span> {a.op}<span className="muted"> {fmtDate(a.at)}</span></li>)}</ol>
    </section>
  );
}
