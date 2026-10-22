import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '../components/common/Card';
import { useApp } from '../state/AppContext';
import { useTenders } from '../hooks/useTenders';
import { chainApi } from '../services/api';
import type { BidMode, ChainConstants, Criterion, TenderKind } from '../types';
import { TENDER_KIND_LABEL } from '../types';
import { weightSum } from '../lib/gates';
import { blocksToDuration, formatBlock } from '../lib/blocks';
import { explainError, type ErrorView } from '../lib/errors';
import { ActionError } from '../components/common/ActionError';

/** `MaxTitleLen` / `MaxSummaryLen` in this runtime (bytes). */
const MAX_TITLE_BYTES = 128;
const MAX_SUMMARY_BYTES = 512;

const STEPS = ['Basics', 'Criteria & weights', 'Gates', 'Eligibility & bond', 'Review'] as const;

interface GateForm {
  publishAt: number;
  questionsCloseAt: number;
  submissionCloseAt: number;
  openingAt: number;
  openingEndAt: number;
  standstillPeriod: number;
}

/**
 * How long the default ("auto") test run should take, end to end.
 *
 * This is the frontend's call, not the chain's — change this number to make the
 * default schedule longer or shorter and it takes effect on reload, with no
 * runtime change and no node rebuild.
 *
 * The one part the chain does dictate is the reveal window: `open_tender`
 * rejects anything leaving less than `MinRevealWindow` blocks still to run, so
 * a target shorter than that floor is clamped up to it rather than producing a
 * tender that could never be opened.
 */
const TEST_RUN_MINUTES = 25;

/** Publish, ask a question, get a bid in — the phase before opening needs this many blocks. */
const MIN_SUBMISSION_BLOCKS = 60;

/** Blocks from creation until the tender publishes (10 blocks ≈ 1 min at 6s). */
const PUBLISH_DELAY_BLOCKS = 10;

/** Blocks the Q&A window stays open after publication (20 blocks ≈ 2 min). */
const QUESTION_BLOCKS = 20;

/**
 * Blocks past `openingAt` the officer still has to click Open before the
 * remaining window drops under `MinRevealWindow` (50 blocks ≈ 5 min at 6s).
 */
const OPEN_SLACK_BLOCKS = 50;

/**
 * A whole-lifecycle schedule sized to `TEST_RUN_MINUTES`, anchored on `now`
 * (the live head).
 *
 * Gates are absolute block numbers, so a schedule is only meaningful relative
 * to the block it was computed from — that is why this is re-derived from the
 * head until the officer edits a gate by hand, rather than computed once when
 * the wizard mounted (at which point the first head may not even have arrived
 * and `currentBlock` is still 0).
 *
 * `openingEndAt - openingAt` is the one gap that cannot be compressed: the
 * pallet rejects `open_tender` with `RevealWindowTooShort` below
 * `MinRevealWindow`, and it measures that from the block the officer actually
 * clicks Open, not from `openingAt` — hence `OPEN_SLACK_BLOCKS` on top.
 */
function testRunGates(now: number, constants: ChainConstants | null): GateForm {
  const blockSeconds = constants?.avgBlockTimeSeconds ?? 6;
  const reveal = (constants?.minRevealWindow ?? 100) + OPEN_SLACK_BLOCKS;
  const standstill = Math.max(constants?.minStandstillPeriod ?? 0, 10);

  const targetBlocks = Math.round((TEST_RUN_MINUTES * 60) / blockSeconds);
  const submissionClose = Math.max(MIN_SUBMISSION_BLOCKS, targetBlocks - reveal - standstill);

  return {
    publishAt: now + PUBLISH_DELAY_BLOCKS,
    questionsCloseAt: now + PUBLISH_DELAY_BLOCKS + QUESTION_BLOCKS,
    submissionCloseAt: now + submissionClose,
    openingAt: now + submissionClose,
    openingEndAt: now + submissionClose + reveal,
    standstillPeriod: standstill,
  };
}

type TimeUnit = 'min' | 'hour' | 'day';

const UNIT_SECONDS: Record<TimeUnit, number> = { min: 60, hour: 3600, day: 86400 };
const UNIT_LABEL: Record<TimeUnit, string> = { min: 'minutes', hour: 'hours', day: 'days' };

interface Duration {
  value: number;
  unit: TimeUnit;
}

/**
 * What the officer actually types: every gate as a time from now (and the
 * standstill as a length of time), not as a block number. The chain still
 * takes absolute blocks, so these are converted against the live head and the
 * average block time — which also means the schedule keeps tracking the head
 * however long the wizard sits open.
 */
type DurationForm = Record<keyof GateForm, Duration>;

function toBlocks(d: Duration, blockSeconds: number): number {
  return Math.ceil((Math.max(0, d.value) * UNIT_SECONDS[d.unit]) / blockSeconds);
}

/** The auto test-run schedule expressed as minutes from now. */
function testRunDurations(constants: ChainConstants | null): DurationForm {
  const blockSeconds = constants?.avgBlockTimeSeconds ?? 6;
  const offsets = testRunGates(0, constants);
  const minutes = (blocks: number): Duration => ({ value: +((blocks * blockSeconds) / 60).toFixed(2), unit: 'min' });
  return {
    publishAt: minutes(offsets.publishAt),
    questionsCloseAt: minutes(offsets.questionsCloseAt),
    submissionCloseAt: minutes(offsets.submissionCloseAt),
    openingAt: minutes(offsets.openingAt),
    openingEndAt: minutes(offsets.openingEndAt),
    standstillPeriod: minutes(offsets.standstillPeriod),
  };
}

function durationsToGates(now: number, d: DurationForm, blockSeconds: number): GateForm {
  const at = (x: Duration) => now + toBlocks(x, blockSeconds);
  return {
    publishAt: at(d.publishAt),
    questionsCloseAt: at(d.questionsCloseAt),
    submissionCloseAt: at(d.submissionCloseAt),
    openingAt: at(d.openingAt),
    openingEndAt: at(d.openingEndAt),
    standstillPeriod: toBlocks(d.standstillPeriod, blockSeconds),
  };
}

/** Blocks from `now` to the last gate a full run has to wait out. */
function runLength(gates: GateForm, now: number): number {
  return Math.max(0, gates.openingEndAt + gates.standstillPeriod - now);
}

export function CreateTenderWizard() {
  const navigate = useNavigate();
  const { accounts, currentAccount, currentBlock, constants } = useApp();
  const { tenders } = useTenders();
  const [step, setStep] = useState(0);

  const officers = accounts.filter((a) => a.role === 'Officer');
  const eoiTenders = tenders.filter((t) => t.kind === 'EOI');

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [entity, setEntity] = useState('');
  const [officer, setOfficer] = useState(currentAccount?.role === 'Officer' ? currentAccount.address : officers[0]?.address ?? '');
  const [kind, setKind] = useState<TenderKind>('RFT');
  const [bidMode, setBidMode] = useState<BidMode>('Sealed');
  const [blindQuestions, setBlindQuestions] = useState(true);
  const [shortlistFromTenderId, setShortlistFromTenderId] = useState('');

  const [criteria, setCriteria] = useState<Criterion[]>([
    { id: 'c1', name: 'Technical capability', description: '', weight: 40, maxScore: 100 },
    { id: 'c2', name: 'Price', description: '', weight: 40, maxScore: 100 },
    { id: 'c3', name: 'Past performance', description: '', weight: 20, maxScore: 100 },
  ]);

  // The officer enters gates as times from now; they only become *state* once
  // edited. Either way they are converted to absolute blocks against the live
  // head on every render, so the schedule stays correct however long the
  // earlier steps take to fill in — a block number computed when the wizard
  // mounted (possibly before the first head arrived, at block 0) would be
  // stale or already in the past by the time Create is clicked.
  const blockSeconds = constants?.avgBlockTimeSeconds ?? 6;
  const [pinnedDurations, setPinnedDurations] = useState<DurationForm | null>(null);
  const autoDurations = useMemo(() => testRunDurations(constants), [constants]);
  const durations = pinnedDurations ?? autoDurations;
  const gates = useMemo(() => durationsToGates(currentBlock, durations, blockSeconds), [currentBlock, durations, blockSeconds]);
  const gatesPinned = pinnedDurations !== null;
  const setDuration = (key: keyof GateForm, patch: Partial<Duration>) =>
    setPinnedDurations({ ...durations, [key]: { ...durations[key], ...patch } });

  const [credentials, setCredentials] = useState('');
  const [minReputation, setMinReputation] = useState(0);
  const [bondAmount, setBondAmount] = useState('0');
  const [bondCurrency, setBondCurrency] = useState('LKR');
  const [forfeitOnWithdrawal, setForfeitOnWithdrawal] = useState(false);

  const totalWeight = weightSum(criteria);

  const gateErrors = useMemo(() => {
    const errs: string[] = [];
    if (!(gates.publishAt < gates.questionsCloseAt)) errs.push('publishAt must be before questionsCloseAt.');
    if (!(gates.questionsCloseAt < gates.submissionCloseAt)) errs.push('questionsCloseAt must be before submissionCloseAt.');
    if (!(gates.submissionCloseAt <= gates.openingAt)) errs.push('submissionCloseAt must be at or before openingAt.');
    if (!(gates.openingAt < gates.openingEndAt)) errs.push('openingAt must be before openingEndAt.');
    if (constants && gates.openingEndAt - gates.openingAt < constants.minRevealWindow) {
      errs.push(`Opening must stay open at least ${blocksToDuration(constants.minRevealWindow, blockSeconds)} (MinRevealWindow = ${constants.minRevealWindow} blocks).`);
    }
    if (constants && gates.standstillPeriod < constants.minStandstillPeriod) {
      errs.push(`Standstill period must be at least ${blocksToDuration(constants.minStandstillPeriod, blockSeconds)} (MinStandstillPeriod = ${constants.minStandstillPeriod} blocks).`);
    }
    return errs;
  }, [gates, constants, blockSeconds]);

  const buffer = gates.submissionCloseAt - currentBlock;
  const lowBuffer = buffer < 200;

  // Byte lengths, because the pallet bounds `title`/`summary` as `BoundedVec<u8>`
  // and a non-ASCII character takes more than one byte.
  const byteLen = (v: string) => new TextEncoder().encode(v).length;

  // Every reason the current step cannot advance, spelled out — a greyed-out
  // Next button with no explanation is indistinguishable from a broken one.
  const basicsIssues: string[] = [];
  if (!title.trim()) basicsIssues.push('Enter a title.');
  else if (byteLen(title.trim()) > MAX_TITLE_BYTES) basicsIssues.push(`Title is too long (max ${MAX_TITLE_BYTES} bytes).`);
  if (!summary.trim()) basicsIssues.push('Enter a summary.');
  else if (byteLen(summary.trim()) > MAX_SUMMARY_BYTES) basicsIssues.push(`Summary is too long (max ${MAX_SUMMARY_BYTES} bytes).`);
  if (!entity.trim()) basicsIssues.push('Enter the procuring entity.');
  if (!officer) basicsIssues.push('Pick an officer account — switch an account to the Officer role in the header if none is listed.');
  if (bidMode === 'Open' && kind !== 'RFQ') basicsIssues.push('Open bidding is only allowed for a Request for Quote (RFQ). Choose Sealed, or change the kind to RFQ.');

  const criteriaIssues: string[] = [];
  if (criteria.length === 0) criteriaIssues.push('Add at least one criterion.');
  if (totalWeight !== 100) criteriaIssues.push(`Weights add up to ${totalWeight}% — they must total exactly 100%.`);
  if (criteria.some((c) => !c.name.trim())) criteriaIssues.push('Every criterion needs a name.');
  if (criteria.some((c) => c.weight < 0 || c.weight > 100 || !Number.isInteger(c.weight))) criteriaIssues.push('Weights must be whole numbers between 0 and 100.');

  const bondIssues: string[] = [];
  if (!/^\d+$/.test(bondAmount.trim() || '0')) bondIssues.push('Bond amount must be a whole number (in the chain’s smallest unit), e.g. 0 or 1000.');
  if (!Number.isInteger(minReputation) || minReputation < 0) bondIssues.push('Minimum reputation must be a whole number ≥ 0.');

  const stepIssues = [basicsIssues, criteriaIssues, gateErrors, bondIssues, [...basicsIssues, ...criteriaIssues, ...gateErrors, ...bondIssues]][step];
  const stepValid = stepIssues.length === 0;

  const updateCriterion = (id: string, patch: Partial<Criterion>) =>
    setCriteria(criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const addCriterion = () =>
    setCriteria([...criteria, { id: `c${criteria.length + 1}-${Date.now()}`, name: '', description: '', weight: 0, maxScore: constants?.maxScore ?? 100 }]);

  const removeCriterion = (id: string) => setCriteria(criteria.filter((c) => c.id !== id));

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ErrorView | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await chainApi.createTender({
        title: title.trim(),
        summary: summary.trim(),
        entity: entity.trim(),
        officer,
        kind,
        bidMode,
        criteria,
        gates,
        eligibility: {
          requiredCredentials: credentials.split(',').map((c) => c.trim()).filter(Boolean),
          minReputation,
        },
        bond: { amount: bondAmount.trim() || '0', currency: bondCurrency, forfeitOnWithdrawal },
        blindQuestions,
        shortlistFromTenderId: kind === 'RFT' && shortlistFromTenderId ? shortlistFromTenderId : undefined,
      });
      // Straight to the new draft, where it can be reviewed, published or deleted.
      navigate(`/tenders/${created.id}`);
    } catch (err) {
      console.error('[tenderchain] create_tender failed', err);
      setSubmitError(explainError(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Create tender</h1>
      <p className="mb-5 text-sm text-slate-500">Every field here becomes part of the public, immutable notice once published.</p>

      <div className="mb-5 flex items-center gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => i < step && setStep(i)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {i < step ? '✓' : i + 1}. {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardBody>
              {step === 0 && (
                <div className="space-y-3">
                  <Field label="Title">
                    <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
                  </Field>
                  <Field label="Summary">
                    <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className="input" />
                  </Field>
                  <Field label="Procuring entity">
                    <input value={entity} onChange={(e) => setEntity(e.target.value)} className="input" placeholder="e.g. Department of Works" />
                  </Field>
                  <Field label="Officer account">
                    <select value={officer} onChange={(e) => setOfficer(e.target.value)} className="input">
                      <option value="">Select officer…</option>
                      {officers.map((o) => <option key={o.address} value={o.address}>{o.name}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tender kind">
                      <select
                        value={kind}
                        onChange={(e) => {
                          const next = e.target.value as TenderKind;
                          setKind(next);
                          // `create_tender` refuses open bidding outside an RFQ.
                          if (next !== 'RFQ') setBidMode('Sealed');
                        }}
                        className="input"
                      >
                        {Object.entries(TENDER_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label="Bid mode">
                      <select value={bidMode} onChange={(e) => setBidMode(e.target.value as BidMode)} className="input">
                        <option value="Sealed">Sealed (commit → reveal)</option>
                        <option value="Open" disabled={kind !== 'RFQ'}>
                          Open{kind !== 'RFQ' ? ' (RFQ only)' : ''}
                        </option>
                      </select>
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={blindQuestions} onChange={(e) => setBlindQuestions(e.target.checked)} />
                    Allow bidders to ask questions anonymously (blind Q&A)
                  </label>
                  {kind === 'RFT' && (
                    <Field label="Shortlist from EOI (optional)">
                      <select value={shortlistFromTenderId} onChange={(e) => setShortlistFromTenderId(e.target.value)} className="input">
                        <option value="">None — open to all eligible bidders</option>
                        {eoiTenders.map((t) => <option key={t.id} value={t.id}>{t.id} — {t.title}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
              )}

              {step === 1 && (
                <div>
                  <div className="space-y-2.5">
                    {criteria.map((c) => (
                      <div key={c.id} className="rounded-md border border-slate-100 p-2.5">
                        {/* Grid, not flex: the weight field's width has to win over `.input`'s
                            own `width: 100%`, and fighting that with a `w-20` utility on the
                            input itself is exactly the losing battle that produced a full-width
                            weight box and a collapsed name box. A grid track has no such
                            conflict — each input's `width: 100%` resolves against its track,
                            and the track widths are the parent's problem, not each child's. */}
                        <div className="grid grid-cols-[1fr_5rem_auto_auto] items-center gap-2">
                          <input
                            value={c.name}
                            onChange={(e) => updateCriterion(c.id, { name: e.target.value })}
                            placeholder="Criterion name"
                            aria-label="Criterion name"
                            className="input min-w-0"
                          />
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={c.weight}
                            onChange={(e) => updateCriterion(c.id, { weight: Number(e.target.value) })}
                            aria-label="Weight (percent)"
                            className="input min-w-0 text-right"
                          />
                          <span className="text-xs text-slate-400">%</span>
                          <button
                            onClick={() => removeCriterion(c.id)}
                            aria-label="Remove criterion"
                            className="text-slate-400 hover:text-red-500"
                          >
                            ✕
                          </button>
                        </div>
                        <input
                          value={c.description}
                          onChange={(e) => updateCriterion(c.id, { description: e.target.value })}
                          placeholder="Description"
                          aria-label="Criterion description"
                          className="input mt-1.5"
                        />
                      </div>
                    ))}
                  </div>
                  <button onClick={addCriterion} className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700">+ Add criterion</button>
                  <div className={`mt-3 rounded-md px-3 py-2 text-sm font-medium ${totalWeight === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    Total weight: {totalWeight}% {totalWeight !== 100 && '— must sum to exactly 100%'}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  {(
                    [
                      ['publishAt', 'Publish at'],
                      ['questionsCloseAt', 'Questions close at'],
                      ['submissionCloseAt', 'Submission closes at'],
                      ['openingAt', 'Opening begins at'],
                      ['openingEndAt', 'Opening ends at'],
                    ] as [keyof GateForm, string][]
                  ).map(([key, label]) => (
                    <Field key={key} label={`${label} (time from now)`}>
                      <DurationInput value={durations[key]} onChange={(patch) => setDuration(key, patch)}>
                        → block {formatBlock(gates[key])}
                      </DurationInput>
                    </Field>
                  ))}
                  <div className={`rounded-md border border-dashed p-3 ${gatesPinned ? 'border-slate-300' : 'border-emerald-300 bg-emerald-50/40'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-700">
                        {gatesPinned ? 'Using the times you entered' : `⚡ Auto: ~${TEST_RUN_MINUTES}-minute test run`}
                      </span>
                      {gatesPinned && (
                        <button
                          type="button"
                          onClick={() => setPinnedDurations(null)}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          ↺ Back to the {TEST_RUN_MINUTES}-minute test gates
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {gatesPinned ? (
                        <>
                          Times are counted from the live head ({formatBlock(currentBlock)}) and converted to block
                          numbers at ~{blockSeconds}s per block when you hit Create.
                        </>
                      ) : (
                        <>
                          Every gate is counted from the live head ({formatBlock(currentBlock)}), so it stays correct
                          however long you spend on the earlier steps. Change any time above to set your own schedule.
                        </>
                      )}{' '}
                      The reveal window still has to clear MinRevealWindow ({constants?.minRevealWindow ?? 100} blocks ≈{' '}
                      {blocksToDuration(constants?.minRevealWindow ?? 100, constants?.avgBlockTimeSeconds ?? 6)}), which
                      is the one gap that cannot be compressed — it is most of the {TEST_RUN_MINUTES} minutes.
                    </p>
                    <p className="mt-1.5 text-xs font-medium text-slate-600">
                      Full run, create → Contracted: {runLength(gates, currentBlock).toLocaleString()} blocks ≈{' '}
                      {blocksToDuration(runLength(gates, currentBlock), constants?.avgBlockTimeSeconds ?? 6)}
                    </p>
                  </div>

                  <Field label="Standstill period (after award approval)">
                    <DurationInput value={durations.standstillPeriod} onChange={(patch) => setDuration('standstillPeriod', patch)}>
                      = {gates.standstillPeriod.toLocaleString()} blocks
                    </DurationInput>
                  </Field>

                  {gateErrors.length > 0 && (
                    <ul className="rounded-md bg-red-50 p-3 text-xs text-red-700">
                      {gateErrors.map((e) => <li key={e}>• {e}</li>)}
                    </ul>
                  )}
                  {gateErrors.length === 0 && gatesPinned && lowBuffer && (
                    <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-700">
                      ⚠ Only {blocksToDuration(buffer, blockSeconds)} between now and submission close — consider more buffer for bidders to respond.
                    </p>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <Field label="Required credentials (comma-separated)">
                    <input value={credentials} onChange={(e) => setCredentials(e.target.value)} className="input" placeholder="e.g. ICTAD-Grade-C1, Tax-Compliance-Cert" />
                  </Field>
                  <Field label="Minimum reputation score">
                    <input type="number" value={minReputation} onChange={(e) => setMinReputation(Number(e.target.value))} className="input w-32" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Bond amount">
                      <input value={bondAmount} onChange={(e) => setBondAmount(e.target.value)} className="input" />
                    </Field>
                    <Field label="Currency">
                      <input value={bondCurrency} onChange={(e) => setBondCurrency(e.target.value)} className="input" />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={forfeitOnWithdrawal} onChange={(e) => setForfeitOnWithdrawal(e.target.checked)} />
                    Bond is forfeited if a bidder withdraws after committing
                  </label>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3 text-sm">
                  <SummaryRow label="Title" value={title} />
                  <SummaryRow label="Entity / Officer" value={`${entity} / ${officers.find((o) => o.address === officer)?.name ?? officer}`} />
                  <SummaryRow label="Kind / Mode" value={`${TENDER_KIND_LABEL[kind]} · ${bidMode}`} />
                  <SummaryRow label="Criteria" value={criteria.map((c) => `${c.name} (${c.weight}%)`).join(', ')} />
                  <SummaryRow label="Gates" value={`publish #${gates.publishAt} → Q&A close #${gates.questionsCloseAt} → submission close #${gates.submissionCloseAt} → opening #${gates.openingAt}-${gates.openingEndAt}`} />
                  <SummaryRow label="Standstill" value={`${blocksToDuration(gates.standstillPeriod, blockSeconds)} (${gates.standstillPeriod} blocks)`} />
                  <SummaryRow
                    label="Full run"
                    value={`${runLength(gates, currentBlock).toLocaleString()} blocks ≈ ${blocksToDuration(
                      runLength(gates, currentBlock),
                      constants?.avgBlockTimeSeconds ?? 6,
                    )} from now${gatesPinned ? '' : ' — gates still tracking the live head'}`}
                  />
                  <SummaryRow label="Eligibility" value={credentials || 'None'} />
                  <SummaryRow label="Bond" value={`${bondAmount} ${bondCurrency}${forfeitOnWithdrawal ? ' (forfeit on withdrawal)' : ''}`} />
                  <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">
                    The tender will be created in <strong>Draft</strong> state. Publish it from the tender detail page when ready — publication is a separate on-chain action so you can review first.
                  </p>
                  {submitError && (
                    <div>
                      <p className="text-xs font-semibold text-red-700">The chain refused to create this tender:</p>
                      <ActionError error={submitError} onDismiss={() => setSubmitError(null)} />
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {!stepValid && (
            <div role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <p className="font-semibold">Fix the following to continue:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {stepIssues.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          )}

          <div className="mt-4 flex justify-between">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!stepValid}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                Next
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting || !stepValid}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {submitting ? 'Creating…' : 'Create draft tender'}
              </button>
            )}
          </div>
        </div>

        <div>
          <Card>
            <CardHeader title="Chain constants check" subtitle="Fetched live from the pallet's runtime constants." />
            <CardBody className="space-y-2 text-xs">
              {constants ? (
                <>
                  <ConstRow label="MinEvaluators" value={constants.minEvaluators} />
                  <ConstRow label="MinRevealWindow" value={`${constants.minRevealWindow} blocks`} />
                  <ConstRow label="MaxScore" value={constants.maxScore} />
                  <ConstRow label="MinStandstillPeriod" value={`${constants.minStandstillPeriod} blocks`} />
                  <ConstRow label="Avg block time" value={`${constants.avgBlockTimeSeconds}s`} />
                </>
              ) : (
                <p className="text-slate-400">Loading constants…</p>
              )}
              <div className="mt-2 border-t border-slate-100 pt-2">
                {gateErrors.length === 0 ? (
                  <p className="text-emerald-600">✓ Gate schedule satisfies all constants.</p>
                ) : (
                  <p className="text-red-600">✗ {gateErrors.length} issue(s) with the gate schedule — see step 3.</p>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <style>{`.input { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; font-size: 14px; outline: none; } .input:focus { border-color: #60a5fa; }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function DurationInput({
  value,
  onChange,
  children,
}: {
  value: Duration;
  onChange: (patch: Partial<Duration>) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        step="any"
        value={value.value}
        onChange={(e) => onChange({ value: Number(e.target.value) })}
        className="input w-28"
      />
      <select
        value={value.unit}
        onChange={(e) => onChange({ unit: e.target.value as TimeUnit })}
        className="input w-32"
      >
        {(Object.keys(UNIT_LABEL) as TimeUnit[]).map((u) => (
          <option key={u} value={u}>{UNIT_LABEL[u]}</option>
        ))}
      </select>
      {children && <span className="text-xs text-slate-400">{children}</span>}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-2">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-slate-800">{value}</span>
    </div>
  );
}

function ConstRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}
