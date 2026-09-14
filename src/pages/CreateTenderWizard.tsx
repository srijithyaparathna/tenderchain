import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '../components/common/Card';
import { useApp } from '../state/AppContext';
import { useTenders } from '../hooks/useTenders';
import { chainApi } from '../services/mockChainApi';
import type { BidMode, Criterion, TenderKind } from '../types';
import { TENDER_KIND_LABEL } from '../types';
import { weightSum } from '../lib/gates';
import { blocksToDuration, formatBlock } from '../lib/blocks';

const STEPS = ['Basics', 'Criteria & weights', 'Gates', 'Eligibility & bond', 'Review'] as const;

interface GateForm {
  publishAt: number;
  questionsCloseAt: number;
  submissionCloseAt: number;
  openingAt: number;
  openingEndAt: number;
  standstillPeriod: number;
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

  const [gates, setGates] = useState<GateForm>({
    publishAt: currentBlock + 50,
    questionsCloseAt: currentBlock + 1000,
    submissionCloseAt: currentBlock + 2000,
    openingAt: currentBlock + 2050,
    openingEndAt: currentBlock + 2250,
    standstillPeriod: 150,
  });

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
      errs.push(`Reveal window (openingEndAt − openingAt) must be at least MinRevealWindow = ${constants.minRevealWindow} blocks.`);
    }
    if (constants && gates.standstillPeriod < constants.minStandstillPeriod) {
      errs.push(`Standstill period must be at least MinStandstillPeriod = ${constants.minStandstillPeriod} blocks.`);
    }
    return errs;
  }, [gates, constants]);

  const buffer = gates.submissionCloseAt - currentBlock;
  const lowBuffer = buffer < 200;

  const basicsValid = title.trim() && summary.trim() && entity.trim() && officer;
  const criteriaValid = criteria.length > 0 && totalWeight === 100 && criteria.every((c) => c.name.trim());
  const gatesValid = gateErrors.length === 0;

  const stepValid = [basicsValid, criteriaValid, gatesValid, true, true][step];

  const updateCriterion = (id: string, patch: Partial<Criterion>) =>
    setCriteria(criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const addCriterion = () =>
    setCriteria([...criteria, { id: `c${criteria.length + 1}-${Date.now()}`, name: '', description: '', weight: 0, maxScore: constants?.maxScore ?? 100 }]);

  const removeCriterion = (id: string) => setCriteria(criteria.filter((c) => c.id !== id));

  const submit = async () => {
    await chainApi.createTender({
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
      bond: { amount: bondAmount, currency: bondCurrency, forfeitOnWithdrawal },
      blindQuestions,
      shortlistFromTenderId: kind === 'RFT' && shortlistFromTenderId ? shortlistFromTenderId : undefined,
    });
    navigate('/');
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
                      <select value={kind} onChange={(e) => setKind(e.target.value as TenderKind)} className="input">
                        {Object.entries(TENDER_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label="Bid mode">
                      <select value={bidMode} onChange={(e) => setBidMode(e.target.value as BidMode)} className="input">
                        <option value="Sealed">Sealed (commit → reveal)</option>
                        <option value="Open">Open</option>
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
                        <div className="flex items-center gap-2">
                          <input value={c.name} onChange={(e) => updateCriterion(c.id, { name: e.target.value })} placeholder="Criterion name" className="input flex-1" />
                          <input
                            type="number"
                            value={c.weight}
                            onChange={(e) => updateCriterion(c.id, { weight: Number(e.target.value) })}
                            className="input w-20"
                          />
                          <span className="text-xs text-slate-400">%</span>
                          <button onClick={() => removeCriterion(c.id)} className="text-slate-400 hover:text-red-500">✕</button>
                        </div>
                        <input
                          value={c.description}
                          onChange={(e) => updateCriterion(c.id, { description: e.target.value })}
                          placeholder="Description"
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
                    <Field key={key} label={`${label} (block number)`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={gates[key]}
                          onChange={(e) => setGates({ ...gates, [key]: Number(e.target.value) })}
                          className="input w-40"
                        />
                        <span className="text-xs text-slate-400">
                          ≈ {gates[key] > currentBlock ? `in ${blocksToDuration(gates[key] - currentBlock, constants?.avgBlockTimeSeconds ?? 6)}` : 'in the past'} ({formatBlock(gates[key])})
                        </span>
                      </div>
                    </Field>
                  ))}
                  <Field label="Standstill period (blocks, after award approval)">
                    <input
                      type="number"
                      value={gates.standstillPeriod}
                      onChange={(e) => setGates({ ...gates, standstillPeriod: Number(e.target.value) })}
                      className="input w-40"
                    />
                  </Field>

                  {gateErrors.length > 0 && (
                    <ul className="rounded-md bg-red-50 p-3 text-xs text-red-700">
                      {gateErrors.map((e) => <li key={e}>• {e}</li>)}
                    </ul>
                  )}
                  {gateErrors.length === 0 && lowBuffer && (
                    <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-700">
                      ⚠ Only {buffer.toLocaleString()} blocks between now and submission close — consider more buffer for bidders to respond.
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
                  <SummaryRow label="Standstill" value={`${gates.standstillPeriod} blocks`} />
                  <SummaryRow label="Eligibility" value={credentials || 'None'} />
                  <SummaryRow label="Bond" value={`${bondAmount} ${bondCurrency}${forfeitOnWithdrawal ? ' (forfeit on withdrawal)' : ''}`} />
                  <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">
                    The tender will be created in <strong>Draft</strong> state. Publish it from the tender detail page when ready — publication is a separate on-chain action so you can review first.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

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
              <button onClick={submit} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                Create draft tender
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
