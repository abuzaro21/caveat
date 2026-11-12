// The decision policy: pure functions from (evidence, tombstones, query, virtual time) to a Decision.
// No I/O and no randomness, so every verdict is reproducible from the stored evidence (test/policy.test.ts).
import {
  DAY, PREDICATES, gradeRank, sameValue, scopeKey, scopeLabel, valueLabel, SUBJECTS,
  type Evidence, type Grade, type Outcome, type PredicateId, type Purpose, type Scope, type SourceKind, type SubjectId,
} from './model.ts';

export type Tombstone = {
  subject: SubjectId; predicate: PredicateId;
  /** 'block': forget and never relearn this topic. 'before': forget what was known; new statements may be learned. */
  mode: 'block' | 'before';
  revokedAt: number; // virtual time of the revocation: evidence observed at or before it can never be re-ingested
};

export type Query = {
  actor: SubjectId; subject: SubjectId; predicate: PredicateId; scope?: Scope;
  purpose: Purpose; consentPurpose?: string; now: number;
};

export type Role =
  | 'leader' | 'supports' | 'conflict' | 'dispute' | 'weak-dissent' | 'outdated' | 'corrected'
  | 'less-specific' | 'out-of-scope' | 'not-valid-now';

export type Considered = {
  id: string; sourceKind: SourceKind; sourceLabel: string; excerpt: string; observedAt: number; stance: Evidence['stance'];
  valueLabel: string; scope: string; grade: Grade; role: Role; why: string;
};

export type Freshness = { state: 'fresh' | 'review-due' | 'stale'; ageDays: number; actionHorizonDays: number; adviceHorizonDays: number; lastConfirmed: number };
export type Conflict = { state: 'none' | 'contested' | 'disputed-after-correction' | 'weak-dissent'; explanation: string };

export type Decision = {
  subject: SubjectId; predicate: PredicateId; label: string; scope: string; purpose: Purpose;
  outcome: Outcome;
  value?: unknown; valueLabel?: string;
  grade?: Grade; gradeReasons: string[];
  freshness?: Freshness;
  scopeMatch: 'exact' | 'general' | 'none';
  conflict: Conflict;
  considered: Considered[];
  blockedBy?: 'revoked' | 'consent' | 'not-permitted';
  reasons: string[];
  mightBeWrong: boolean;
  sentence: string;
  next: 'proceed' | 'proceed-with-caveat' | 'ask-user' | 'stop';
  evaluatedAt: number;
};

const fmt = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const days = (ms: number) => Math.floor(ms / DAY);
const fmtShort = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The grade of one piece of evidence for one predicate (docs/CONFIDENCE-AND-FRESHNESS.md, table 1). */
export function baseGrade(p: PredicateId, k: SourceKind): { grade: Grade; reason: string } {
  if (PREDICATES[p].authoritativeKinds.includes(k)) return { grade: 'authoritative', reason: `${kindLabel(k)}: entitled to establish ${PREDICATES[p].label.toLowerCase()}` };
  if (k === 'model_inference') return { grade: 'inferred', reason: 'a guess from patterns, never a statement' };
  return { grade: 'reported', reason: `${kindLabel(k)}: attributable, but not entitled to establish ${PREDICATES[p].label.toLowerCase()}` };
}
export function kindLabel(k: SourceKind) {
  return { user_statement: 'Direct statement', user_correction: 'Explicit correction', trusted_import: 'Trusted import', observed_event: 'Observed event', third_party: 'Third-party report', model_inference: 'Model inference' }[k];
}

function expiredNote(c: Map<string, Considered>) {
  const ex = [...c.values()].filter((x) => x.role === 'not-valid-now');
  return ex.length ? `The only memory I have of this applies to another time (${ex[0].why.replace(': describes another time', '')}), so I won't use it now.` : null;
}

export function evaluate(all: Evidence[], tombstones: Tombstone[], q: Query): Decision {
  const pol = PREDICATES[q.predicate];
  const want = scopeKey(q.predicate, q.scope);
  const base = { subject: q.subject, predicate: q.predicate, label: pol.label, scope: scopeLabel(want), purpose: q.purpose, evaluatedAt: q.now, gradeReasons: [] as string[], considered: [] as Considered[], conflict: { state: 'none', explanation: '' } as Conflict };
  const stop = (blockedBy: Decision['blockedBy'], sentence: string, reasons: string[]): Decision =>
    ({ ...base, outcome: 'ABSTAIN', scopeMatch: 'none', blockedBy, reasons, mightBeWrong: false, sentence, next: 'stop' });

  // 1. Identity and scope of access: whose memory is this, and may this actor read it?
  if (q.actor !== q.subject && (!pol.householdShared || pol.sensitive))
    return stop('not-permitted', `I can't share ${SUBJECTS[q.subject].name}'s ${pol.label.toLowerCase()} with ${SUBJECTS[q.actor].name}.`, ['memory belongs to another person and is not shared with the household']);
  if (q.purpose === 'inspection' && q.actor !== q.subject)
    return stop('not-permitted', 'Only the person a memory is about can inspect it.', ['inspection is limited to the memory subject']);
  // 2. Consent: sensitive memories are usable only for the purposes the person agreed to.
  if (pol.sensitive && q.purpose !== 'inspection' && !(q.consentPurpose && pol.consentedPurposes.includes(q.consentPurpose)))
    return stop('consent', `That memory isn't available for this purpose.`, [`sensitive: consented only for ${pol.consentedPurposes.join(', ')}`]);
  // 3. Revocation: a blocked topic is never answered, whatever evidence might still be in flight.
  if (tombstones.some((t) => t.subject === q.subject && t.predicate === q.predicate && t.mode === 'block'))
    return stop('revoked', `You asked me to forget this and not to relearn it, so I have nothing I'm allowed to use.`, ['topic revoked by the subject']);

  const mine = all.filter((e) => e.subject === q.subject && e.predicate === q.predicate);
  const considered = new Map<string, Considered>();
  const put = (e: Evidence, role: Role, why: string, grade = baseGrade(q.predicate, e.sourceKind).grade) =>
    considered.set(e.id, { id: e.id, sourceKind: e.sourceKind, sourceLabel: e.sourceLabel, excerpt: e.excerpt, observedAt: e.observedAt, stance: e.stance, valueLabel: valueLabel(q.predicate, e.value), scope: scopeLabel(e.scopeKey), grade, role, why });
  // Who: another household member's shared, non-sensitive memory is shown as a different fact — never merged.
  if (pol.householdShared && !pol.sensitive)
    for (const e of all) if (e.subject !== q.subject && e.predicate === q.predicate && (!e.scopeKey || e.scopeKey === want) && e.stance === 'supports')
      put(e, 'out-of-scope', `about ${SUBJECTS[e.subject].name}, not ${SUBJECTS[q.subject].name}: a different person's fact, not a contradiction`);

  // 4. Scope: exact scope beats general; a different place is not a contradiction, it is a different fact.
  // 5. Temporal validity: evidence outside its own validity interval describes another time.
  const live: Evidence[] = [];
  for (const e of mine) {
    if (e.scopeKey && e.scopeKey !== want) { put(e, 'out-of-scope', `applies to ${scopeLabel(e.scopeKey)}, not ${scopeLabel(want)}: a different fact, not a contradiction`); continue; }
    if ((e.validFrom !== null && e.validFrom > q.now) || (e.validUntil !== null && e.validUntil < q.now)) {
      put(e, 'not-valid-now', e.validUntil !== null && e.validUntil < q.now ? `valid until ${fmt(e.validUntil)}: describes another time` : `valid from ${fmt(e.validFrom!)}`); continue;
    }
    if (e.observedAt > q.now) continue; // cannot happen with a monotonic clock; defensive
    live.push(e);
  }
  const exact = live.filter((e) => e.scopeKey === want && want !== '');
  const tier = exact.length ? exact : live.filter((e) => e.scopeKey === '');
  const scopeMatch: Decision['scopeMatch'] = exact.length || (!want && tier.length) ? 'exact' : tier.length ? 'general' : 'none'; // an unscoped predicate always matches exactly
  for (const e of live) if (!tier.includes(e)) put(e, 'less-specific', `general memory; a ${scopeLabel(want)}-specific one exists`);

  // 6. Explicit corrections supersede everything observed before them, whatever its authority.
  const later = (a: Evidence, b: Evidence) => b.observedAt - a.observedAt || b.seq - a.seq; // newest first; ingestion order breaks ties
  const corrections = tier.filter((e) => e.corrects && e.sourceKind === 'user_correction').sort(later);
  const latestCorrection = corrections[0];
  const active = tier.filter((e) => {
    if (latestCorrection && e !== latestCorrection && later(e, latestCorrection) > 0) {
      put(e, 'corrected', `superseded by your correction on ${fmt(latestCorrection.observedAt)}`); return false;
    }
    return true;
  });

  // 7. Candidates: distinct supported values, each graded by its strongest support (+ independent corroboration).
  type Cand = { value: unknown; supports: Evidence[]; qualifying: Evidence[]; grade: Grade; reasons: string[]; latest: number; latestSeq: number };
  const cands: Cand[] = [];
  for (const e of active.filter((x) => x.stance === 'supports')) {
    let c = cands.find((x) => sameValue(x.value, e.value));
    if (!c) cands.push(c = { value: e.value, supports: [], qualifying: [], grade: 'unsupported', reasons: [], latest: 0, latestSeq: 0 });
    c.supports.push(e);
  }
  for (const c of cands) {
    const graded = c.supports.map((e) => ({ e, ...baseGrade(q.predicate, e.sourceKind) })).sort((a, b) => gradeRank(b.grade) - gradeRank(a.grade));
    c.grade = graded[0].grade; c.reasons = [graded[0].reason];
    // Independence is server-attributed only: an unsigned import's caller-declared lineage earns no corroboration credit.
    const independent = graded.filter((g) => g.grade === 'reported' && g.e.channel !== 'import:unsigned');
    const lineages = new Set(independent.map((g) => g.e.lineage));
    // The support that establishes the effective grade — and only that support — dates the memory. A weaker
    // agreeing report (an unsigned import, say) is shown, but cannot refresh it or outdate disagreement.
    let qualifying = graded.filter((g) => g.grade === c.grade).map((g) => g.e);
    if (c.grade === 'reported' && lineages.size >= 2) {
      c.grade = 'corroborated'; c.reasons.push(`${lineages.size} independent sources agree`);
      // Corroboration exists from the moment the second independent source reported, not from the newest copy.
      const perLineage = [...lineages].map((l) => independent.filter((g) => g.e.lineage === l).map((g) => g.e).sort(later)[0]).sort(later);
      qualifying = [perLineage[1]];
    }
    const newest = qualifying.slice().sort(later)[0];
    c.latest = newest.observedAt; c.latestSeq = newest.seq; c.qualifying = qualifying;
    const copies = c.supports.length - new Set(c.supports.map((e) => e.lineage)).size;
    if (copies > 0) c.reasons.push(`${copies} repeat${copies > 1 ? 's' : ''} from the same source counted once`);
    const unsigned = c.supports.filter((e) => e.channel === 'import:unsigned').length;
    if (unsigned && c.grade !== 'reported') c.reasons.push(`${unsigned} unsigned import${unsigned > 1 ? 's' : ''} shown, not counted`);
  }
  cands.sort((a, b) => gradeRank(b.grade) - gradeRank(a.grade) || b.latest - a.latest || b.latestSeq - a.latestSeq);
  const lead = cands[0];
  const leadEv = lead ? lead.qualifying.slice().sort(later)[0] : undefined;

  if (!lead) {
    for (const e of active) put(e, 'weak-dissent', 'argues against a value, but no value is supported');
    const none = q.purpose === 'action'
      ? { outcome: 'ASK' as const, sentence: `I don't have a usable memory of your ${pol.label.toLowerCase()}${want ? ` for ${scopeLabel(want)}` : ''}. Tell me and I'll remember it.`, next: 'ask-user' as const }
      : { outcome: 'ABSTAIN' as const, sentence: expiredNote(considered) ?? `I don't have a memory I can use for that.`, next: 'stop' as const };
    return { ...base, ...none, scopeMatch, considered: [...considered.values()], reasons: ['no supporting evidence in scope'], mightBeWrong: false };
  }

  // 8. Relate every other piece of evidence to the leading claim: is it newer, stronger, or merely different?
  const leadIsCorrection = lead.supports.some((e) => e === latestCorrection);
  let conflict: Conflict = { state: 'none', explanation: '' };
  const raise = (s: Conflict['state'], explanation: string) => {
    const rank = { none: 0, 'weak-dissent': 1, 'disputed-after-correction': 2, contested: 3 };
    if (rank[s] > rank[conflict.state]) conflict = { state: s, explanation };
  };
  for (const e of active) {
    const g = baseGrade(q.predicate, e.sourceKind).grade;
    const agrees = e.stance === 'supports' && sameValue(e.value, lead.value);
    if (agrees) { put(e, e === leadEv ? 'leader' : 'supports', e === leadEv ? 'the latest confirmation of the leading memory' : lead.qualifying.includes(e) || gradeRank(g) >= gradeRank(lead.grade) ? 'supports the leading memory' : 'agrees, but at lower authority: shown, cannot refresh or settle it'); continue; }
    const against = (e.stance === 'opposes' && sameValue(e.value, lead.value)) || e.stance === 'supports';
    if (!against) { put(e, 'outdated', 'argues against a value that is not the leading memory'); continue; }
    const what = e.stance === 'opposes' ? `suggests ${valueLabel(q.predicate, lead.value)} may no longer be right` : `says ${valueLabel(q.predicate, e.value)}`;
    if (e.observedAt < lead.latest || (e.observedAt === lead.latest && e.seq < lead.latestSeq)) { put(e, 'outdated', `older than the leading memory (${fmt(lead.latest)}); superseded by a later statement`); continue; }
    if (g === 'inferred') { put(e, 'weak-dissent', `a newer guess ${what}; a guess cannot outweigh a statement`); raise('weak-dissent', `${e.sourceLabel} ${what}, but it is only an inference.`); continue; }
    if (leadIsCorrection) { put(e, 'dispute', `newer, but lower authority than your explicit correction: recorded, cannot override it`); raise('disputed-after-correction', `${e.sourceLabel} (${fmt(e.observedAt)}) ${what}; your correction stands.`); continue; }
    put(e, 'conflict', `newer evidence (${fmt(e.observedAt)}) that ${what}`);
    raise('contested', '');
  }
  if (conflict.state === 'contested') {
    // One sentence per disagreeing source, so three log lines from one courier read as one source, three times.
    const bySource = new Map<string, Considered[]>();
    for (const c of considered.values()) if (c.role === 'conflict') bySource.set(c.sourceLabel, [...(bySource.get(c.sourceLabel) ?? []), c]);
    conflict.explanation = [...bySource.entries()].map(([src, cs]) => {
      const ts = cs.map((c) => c.observedAt).sort((a, b) => a - b);
      const span = ts.length > 1 ? `${cs.length} newer reports, ${fmtShort(ts[0])} – ${fmt(ts[ts.length - 1])}` : `a newer report on ${fmt(ts[0])}`;
      const opp = cs[0].stance === 'opposes' ? `suggesting ${valueLabel(q.predicate, lead.value)} may no longer be right` : `saying ${cs[0].valueLabel}`;
      return `${src} has ${span}, ${opp}.`;
    }).join(' ');
  }
  for (const c of cands.slice(1)) for (const e of c.supports) if (!considered.has(e.id)) put(e, 'outdated', 'a weaker or older value');

  // 9. Freshness: the age of the latest confirmation against this predicate's horizons — not a decay coefficient.
  const age = q.now - lead.latest;
  const freshness: Freshness = {
    state: age <= pol.actionHorizonDays * DAY ? 'fresh' : age <= pol.adviceHorizonDays * DAY ? 'review-due' : 'stale',
    ageDays: days(age), actionHorizonDays: pol.actionHorizonDays, adviceHorizonDays: pol.adviceHorizonDays, lastConfirmed: lead.latest,
  };

  // 10. Decision. Consequential actions need strong, fresh, uncontested evidence; anything less asks.
  const strong = lead.grade === 'authoritative' || lead.grade === 'corroborated';
  const reasons: string[] = [];
  if (!strong) reasons.push(`evidence is only ${lead.grade}`);
  if (conflict.state === 'contested') reasons.push('contested by newer evidence');
  if (freshness.state !== 'fresh') reasons.push(`last confirmed ${freshness.ageDays} days ago (action horizon ${pol.actionHorizonDays} days)`);
  if (scopeMatch === 'general') reasons.push(`general memory, not specific to ${scopeLabel(want)}`);
  const clean = strong && conflict.state !== 'contested' && freshness.state === 'fresh';
  // A noted dispute or a newer guess is shown, but does not weaken a strong, fresh memory.
  const outcome: Outcome = clean ? 'USE' : q.purpose === 'action' ? 'ASK' : 'QUALIFY';
  const mightBeWrong = outcome === 'QUALIFY' || outcome === 'ASK';

  const v = valueLabel(q.predicate, lead.value);
  const said = `${leadEv!.sourceKind === 'user_correction' ? 'you corrected it to' : leadEv!.sourceKind === 'user_statement' ? 'you told me' : `${leadEv!.sourceLabel} says`} ${v} on ${fmt(leadEv!.observedAt)}`;
  let sentence: string;
  if (!mightBeWrong) sentence = `${pol.label}${want ? ` (${scopeLabel(want)})` : ''}: ${v} — ${said}.`;
  else {
    const why: string[] = [];
    if (conflict.state === 'contested') why.push(conflict.explanation);
    if (freshness.state !== 'fresh') why.push(`That was ${freshness.ageDays} days ago, and I re-check this kind of memory after ${pol.actionHorizonDays} days.`);
    if (!strong) why.push(`The only support is ${lead.grade}: ${leadEv!.sourceLabel}.`);
    if (scopeMatch === 'general' && why.length === 0) why.push(`It is a general memory, not specific to ${scopeLabel(want)}.`);
    sentence = `I might be wrong about this. ${said[0].toUpperCase() + said.slice(1)}${conflict.state === 'contested' ? ', but' : '.'} ${conflict.state === 'contested' ? why[0] + (why.length > 1 ? ' ' + why.slice(1).join(' ') : '') : why.join(' ')}`.trim();
  }
  return {
    ...base, outcome, value: lead.value, valueLabel: v, grade: lead.grade, gradeReasons: lead.reasons, freshness, scopeMatch, conflict,
    considered: [...considered.values()].sort((a, b) => b.observedAt - a.observedAt), reasons, mightBeWrong, sentence,
    next: outcome === 'USE' ? 'proceed' : outcome === 'QUALIFY' ? 'proceed-with-caveat' : 'ask-user',
  };
}
