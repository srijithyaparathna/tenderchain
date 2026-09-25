import { useState } from 'react';
import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { RoleGatedButton } from '../common/RoleGatedButton';
import { ActionError } from '../common/ActionError';
import { useChainAction } from '../../hooks/useChainAction';
import { formatBlock } from '../../lib/blocks';
import { useApp } from '../../state/AppContext';
import { requireBidder, requireOfficer } from '../../lib/permissions';
import { chainApi } from '../../services/api';

export function QAPanel({ tender }: { tender: Tender }) {
  const { currentAccount, currentBlock, accounts } = useApp();
  const [question, setQuestion] = useState('');
  const [blind, setBlind] = useState(tender.blindQuestions);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const { busy, error, clearError, run } = useChainAction();

  const askDisabled =
    requireBidder(currentAccount) ||
    (currentBlock >= tender.gates.questionsCloseAt ? 'Questions closed at ' + formatBlock(tender.gates.questionsCloseAt) : undefined) ||
    (tender.state !== 'Published' && tender.state !== 'Submission' ? 'Questions can only be asked once the tender is published.' : undefined);

  const nameFor = (addr: string) => accounts.find((a) => a.address === addr)?.name ?? addr;

  const submitQuestion = () => {
    if (!currentAccount || !question.trim()) return;
    run(async () => {
      await chainApi.askQuestion(tender.id, currentAccount.address, question.trim(), blind);
      setQuestion('');
    });
  };

  const submitAnswer = (qaId: string) => {
    if (!answerText.trim()) return;
    run(async () => {
      await chainApi.answerQuestion(tender.id, qaId, answerText.trim());
      setAnswering(null);
      setAnswerText('');
    });
  };

  return (
    <Card>
      <CardHeader
        title="Questions & answers"
        subtitle={tender.blindQuestions ? 'Blind mode: asker identity is hidden from other bidders.' : undefined}
      />
      <CardBody>
        {tender.qa.length === 0 ? (
          <p className="mb-3 text-sm text-slate-400">No questions yet.</p>
        ) : (
          <ul className="mb-3 space-y-3">
            {tender.qa.map((qa) => (
              <li key={qa.id} className="rounded-md border border-slate-100 p-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{qa.blind ? 'Anonymous bidder' : nameFor(qa.askedBy)} · {formatBlock(qa.askedAtBlock)}</span>
                  {!qa.answer && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Awaiting answer</span>}
                </div>
                <p className="mt-1 text-sm text-slate-800">{qa.question}</p>
                {qa.answer ? (
                  <div className="mt-2 rounded-md bg-slate-50 p-2.5">
                    <div className="text-[11px] font-medium text-slate-500">Official answer · {formatBlock(qa.answeredAtBlock!)}</div>
                    <p className="mt-0.5 text-sm text-slate-700">{qa.answer}</p>
                  </div>
                ) : answering === qa.id ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="Type the official answer…"
                      className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
                    />
                    <button
                      disabled={busy}
                      onClick={() => submitAnswer(qa.id)}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Post answer
                    </button>
                  </div>
                ) : (
                  <div className="mt-2">
                    <RoleGatedButton
                      variant="secondary"
                      disabledReason={requireOfficer(currentAccount, tender)}
                      onClick={() => setAnswering(qa.id)}
                    >
                      Answer
                    </RoleGatedButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-slate-100 pt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question about this tender…"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
            {tender.blindQuestions && (
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
                Ask anonymously
              </label>
            )}
            <RoleGatedButton disabledReason={askDisabled} disabled={busy} onClick={submitQuestion}>
              Submit question
            </RoleGatedButton>
          </div>
          <ActionError error={error} onDismiss={clearError} />
        </div>
      </CardBody>
    </Card>
  );
}
