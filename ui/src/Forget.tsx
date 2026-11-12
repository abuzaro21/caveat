// The forgetting center: choose what "forget" means, see exactly what was deleted, and prove it.
import { useEffect, useRef, useState } from 'react';
import type { Memory, Receipt } from './api.ts';
import { fmtDate } from './api.ts';
import { Spinner } from './parts.tsx';

export type Proof = { id: string; label: string; status: 'pending' | 'pass' | 'fail' | 'running'; detail?: string };

export function ForgetDialog({ target, receipt, proofs, backupItems, onConfirm, onClose, onProve, busy }: {
  target: Memory | null; receipt: Receipt | null; proofs: Proof[]; backupItems: number | null;
  onConfirm: (mode: 'block' | 'before') => void; onClose: () => void; onProve: () => void; busy: boolean;
}) {
  const [mode, setMode] = useState<'block' | 'before'>('block');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus(); }, [receipt, target]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!target && !receipt) return null;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="forget-title" ref={ref}>
        {!receipt && target && (
          <>
            <div className="eyebrow">Forgetting center</div>
            <h2 id="forget-title">Forget “{target.policy.label}”</h2>
            <p className="muted">Current value: <b>{target.decision.valueLabel}</b>. Choose what forgetting should mean. Both options delete the content; they differ in what may be learned later.</p>
            <div className="modes" role="radiogroup" aria-label="Forget mode">
              <button role="radio" aria-checked={mode === 'block'} className={`mode ${mode === 'block' ? 'on' : ''}`} onClick={() => setMode('block')}>
                <b>Delete and never relearn</b><span>Removes every record of this topic and refuses to learn it again from any source: chat, imports, old backups, delayed jobs.</span>
              </button>
              <button role="radio" aria-checked={mode === 'before'} className={`mode ${mode === 'before' ? 'on' : ''}`} onClick={() => setMode('before')}>
                <b>Delete what you know, may relearn</b><span>Removes every record. Anything observed before now can never come back; a new statement from you can be remembered again.</span>
              </button>
            </div>
            <div className="will">
              <div><h3>Will be deleted</h3><ul><li>{target.decision.considered.filter((c) => c.role !== 'out-of-scope').length} evidence record(s) with their text</li><li>their search-index entries and usage records</li><li>derived summaries and booking reasons that quoted it (rewritten)</li><li>cached decisions</li></ul></div>
              <div><h3>Will be kept</h3><ul><li>a tombstone: person + topic + time, <b>no value, no text</b></li><li>an audit line and a receipt with counts only</li></ul></div>
            </div>
            <p className="small note">For the demo, two things are set up first: a signed backup kept in this browser tab, and a delayed digest job queued against your memory as it is now. After forgetting, you can try both.</p>
            <p className="small muted">“Stop using” is not offered on its own: hiding a memory while keeping it is exactly the fake deletion CAVEAT exists to avoid.</p>
            <div className="dialog-actions">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn danger" onClick={() => onConfirm(mode)} disabled={busy}>{busy ? <Spinner /> : null}Forget it</button>
            </div>
          </>
        )}
        {receipt && (
          <>
            <div className="eyebrow">Deletion receipt · {receipt.id}</div>
            <h2 id="forget-title">{receipt.verified ? 'Forgotten, and verified' : 'Forgotten — a check failed'}</h2>
            <div className="receipt-grid">
              <div><h3>You asked</h3><p>{receipt.request.topic} — {receipt.request.mode}. Virtual date {fmtDate(receipt.at)}.</p></div>
              <div><h3>Deleted</h3><ul>
                <li>{receipt.deleted.evidence} evidence record(s)</li><li>{receipt.deleted.indexEntries} search-index entries</li>
                <li>{receipt.deleted.usageRecords} usage record(s)</li>{receipt.deleted.cacheEntries !== undefined && <li>{receipt.deleted.cacheEntries} cached decision(s)</li>}
              </ul></div>
              <div><h3>Rewritten</h3><ul><li>{receipt.rewritten.derivedSummaries} derived summar{receipt.rewritten.derivedSummaries === 1 ? 'y' : 'ies'}</li><li>{receipt.rewritten.bookingReasons} booking reason(s) that quoted it</li></ul>{receipt.storage && <p className="small muted">{receipt.storage}</p>}</div>
            </div>
            <h3>Verification — run after the transaction committed</h3>
            <ul className="checks">{receipt.verification.map((v) => <li key={v.check} className={v.pass ? 'pass' : 'fail'}><span className="tick" aria-hidden="true">{v.pass ? '✓' : '✗'}</span>{v.check}<span className="small muted"> expected {v.expected}, got {v.actual}</span></li>)}</ul>
            <div className="receipt-grid two">
              <div><h3>Kept (no content)</h3><ul>{receipt.retained.map((r) => <li key={r}>{r}</li>)}</ul></div>
              <div><h3>Limits — what CAVEAT cannot erase</h3><ul>{receipt.limitations.map((r) => <li key={r}>{r}</li>)}</ul></div>
            </div>
            {receipt.kind === 'forget' && (
              <>
                <h3>Prove it</h3>
                <p className="small muted">{backupItems !== null ? `A backup with ${backupItems} records was exported before the forget and is held in this browser tab, outside CAVEAT — the kind of copy CAVEAT cannot erase. ` : ''}Each step below calls the real backend.</p>
                <ul className="proofs">{proofs.map((p) => <li key={p.id} className={`proof proof-${p.status}`}><span className="tick" aria-hidden="true">{p.status === 'pass' ? '✓' : p.status === 'fail' ? '✗' : p.status === 'running' ? '…' : '○'}</span><b>{p.label}</b>{p.detail && <span className="small muted"> — {p.detail}</span>}</li>)}</ul>
              </>
            )}
            <div className="dialog-actions">
              <button className="btn ghost" onClick={onClose}>Close</button>
              {receipt.kind === 'forget' && <button className="btn primary" onClick={onProve} disabled={busy || proofs.every((p) => p.status === 'pass')}>{busy ? <Spinner /> : null}{proofs.some((p) => p.status !== 'pending') ? 'Run the proofs again' : 'Run the proofs'}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
