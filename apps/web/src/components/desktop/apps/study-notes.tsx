"use client";

import { type StudyKind, type StudyResult, studyResultSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FolderOpen, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { readDriveText } from "@/lib/api/drive";
import { fetchAssistantStatus, studyFromNotes } from "@/lib/api/assistant";
import { saveToDrive } from "./drive-save";
import { OpenFromDrive } from "./open-from-drive";
import { RecordStatus } from "./record-status";
import { useAppRecord } from "./use-app-record";
import { useToast } from "@brawzer/ui/components/toast";

const stateSchema = z.object({ notes: z.string(), result: studyResultSchema.nullable() });

const ACTIONS: { kind: StudyKind; label: string }[] = [
  { kind: "summary", label: "Summarise" },
  { kind: "flashcards", label: "Make flashcards" },
  { kind: "quiz", label: "Practice quiz" },
];

/** The result as text, for Drive. */
function asText(result: StudyResult): string {
  if (result.kind === "summary")
    return `${result.title}\n\n${result.points.map((point) => `• ${point}`).join("\n")}\n`;
  if (result.kind === "flashcards") {
    return result.cards.map((card) => `Q: ${card.front}\nA: ${card.back}`).join("\n\n");
  }
  return result.questions
    .map(
      (q, index) =>
        `${String(index + 1)}. ${q.question}\n${q.choices.map((choice, at) => `   ${String.fromCharCode(97 + at)}) ${choice}`).join("\n")}\n   Answer: ${String.fromCharCode(97 + q.answer)}. ${q.explanation}`,
    )
    .join("\n\n");
}

function Flashcards({ cards }: { cards: Extract<StudyResult, { kind: "flashcards" }>["cards"] }) {
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[at];
  if (!card) return null;
  return (
    <div className="ap-cards">
      <button
        type="button"
        className="ap-flashcard"
        aria-label={
          flipped
            ? `Answer: ${card.back}. Show the question`
            : `Question: ${card.front}. Show the answer`
        }
        data-flipped={flipped || undefined}
        onClick={() => {
          setFlipped((current) => !current);
        }}
      >
        <span aria-hidden="true">{flipped ? card.back : card.front}</span>
      </button>
      <div className="ap-row justify-center">
        <Button
          size="sm"
          disabled={at === 0}
          onClick={() => {
            setAt(at - 1);
            setFlipped(false);
          }}
        >
          Previous
        </Button>
        <span className="text-footnote text-ink-secondary">
          {at + 1} of {cards.length}
        </span>
        <Button
          size="sm"
          disabled={at === cards.length - 1}
          onClick={() => {
            setAt(at + 1);
            setFlipped(false);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function Quiz({ questions }: { questions: Extract<StudyResult, { kind: "quiz" }>["questions"] }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const done = Object.keys(answers).length;
  const right = questions.filter((q, index) => answers[index] === q.answer).length;
  return (
    <div className="ap-quiz">
      {questions.map((q, index) => {
        const chosen = answers[index];
        return (
          <fieldset key={index} className="ap-question">
            <legend>
              {index + 1}. {q.question}
            </legend>
            {q.choices.map((choice, at) => (
              <label
                key={at}
                className="ap-choice"
                data-state={
                  chosen === undefined
                    ? undefined
                    : at === q.answer
                      ? "right"
                      : at === chosen
                        ? "wrong"
                        : undefined
                }
              >
                <input
                  type="radio"
                  name={`question-${String(index)}`}
                  disabled={chosen !== undefined}
                  checked={chosen === at}
                  onChange={() => {
                    setAnswers((current) => ({ ...current, [index]: at }));
                  }}
                />
                {choice}
              </label>
            ))}
            {chosen !== undefined && (
              <p className="ap-explain" role="status">
                {chosen === q.answer ? "Right. " : "Not quite. "}
                {q.explanation}
              </p>
            )}
          </fieldset>
        );
      })}
      <p className="ap-note" role="status">
        {done === questions.length
          ? `You got ${String(right)} of ${String(questions.length)}.`
          : `${String(done)} of ${String(questions.length)} answered.`}
      </p>
    </div>
  );
}

/** Study Notes: a summary, flashcards or a practice quiz from your notes, by Claude. */
export default function StudyNotesApp() {
  const toast = useToast();
  const { value, update, loaded, save, retry } = useAppRecord("study-notes", "state", stateSchema, {
    notes: "",
    result: null,
  });
  const [available, setAvailable] = useState<boolean | null>(null);
  const [working, setWorking] = useState<StudyKind | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    void fetchAssistantStatus().then((result) => {
      setAvailable(result.ok && result.data.available);
    });
  }, []);

  async function make(kind: StudyKind) {
    setWorking(kind);
    setFailure(null);
    const result = await studyFromNotes(value.notes, kind);
    setWorking(null);
    if (result.ok) update((current) => ({ ...current, result: result.data }));
    else
      setFailure(
        result.status === 400
          ? (result.error.details?.[0]?.replace(/^notes: /, "") ?? result.error.message)
          : result.status === 429
            ? "That’s a lot this hour. Try again a little later."
            : "Claude couldn’t do it just now. Try again in a moment.",
      );
  }

  async function saveResult(result: StudyResult) {
    const named = { summary: "Summary", flashcards: "Flashcards", quiz: "Quiz" }[result.kind];
    const saved = await saveToDrive({
      name: `${named} ${new Date().toISOString().slice(0, 10)}.txt`,
      content: asText(result),
      type: "text/plain",
      folder: "Study",
    });
    toast.add(
      saved.ok
        ? { type: "success", title: "Saved in Drive", description: `Study/${saved.data.name}` }
        : { type: "error", title: "Couldn’t save it", description: saved.error.message },
    );
  }

  return (
    <div className="ap-body">
      <div className="ap-split">
        <section className="ap-pane ap-study-notes" aria-labelledby="study-notes-title">
          <div className="ap-row">
            <h2 id="study-notes-title" className="ap-group-title">
              Your notes
            </h2>
            <span className="flex-1" />
            <Button
              size="sm"
              onClick={() => {
                setPicking(true);
              }}
            >
              <FolderOpen aria-hidden="true" />
              From Drive…
            </Button>
          </div>
          <label className="sr-only" htmlFor="study-notes-text">
            Your notes
          </label>
          <textarea
            id="study-notes-text"
            className="ap-input ap-study-text"
            value={value.notes}
            placeholder="Paste or type your lecture notes here"
            onChange={(event) => {
              const notes = event.target.value;
              update((current) => ({ ...current, notes }));
            }}
          />
          {available === false ? (
            <p className="ap-note">
              Summaries, flashcards and quizzes come from the assistant, which isn’t turned on for
              this Brawzer. Your notes are still kept here.
            </p>
          ) : (
            <div className="ap-row flex-wrap">
              {ACTIONS.map((action) => (
                <Button
                  key={action.kind}
                  size="sm"
                  variant={action.kind === "summary" ? "primary" : "secondary"}
                  loading={working === action.kind}
                  disabled={
                    working !== null || value.notes.trim().length < 40 || available === null
                  }
                  onClick={() => void make(action.kind)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
          {failure && (
            <p className="ap-error" role="alert">
              {failure}
            </p>
          )}
          <p className="ap-note">
            Your notes go to Claude, by Anthropic, only when you press one of these.
          </p>
        </section>
        <section className="ap-pane" aria-labelledby="study-result-title">
          <div className="ap-row">
            <h2 id="study-result-title" className="ap-group-title">
              {value.result
                ? {
                    summary: value.result.kind === "summary" ? value.result.title : "Summary",
                    flashcards: "Flashcards",
                    quiz: "Practice quiz",
                  }[value.result.kind]
                : "Results"}
            </h2>
            <span className="flex-1" />
            {value.result && (
              <Button size="sm" onClick={() => value.result && void saveResult(value.result)}>
                <Save aria-hidden="true" />
                Save to Drive
              </Button>
            )}
          </div>
          {!value.result ? (
            <p className="ap-empty">A summary, flashcards or a quiz appears here.</p>
          ) : value.result.kind === "summary" ? (
            <ul className="ap-points">
              {value.result.points.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          ) : value.result.kind === "flashcards" ? (
            <Flashcards key={value.result.cards.length} cards={value.result.cards} />
          ) : (
            <Quiz
              key={value.result.questions.map((q) => q.question).join("|")}
              questions={value.result.questions}
            />
          )}
        </section>
      </div>
      <RecordStatus save={save} loaded={loaded} onRetry={() => void retry()}>
        {value.notes.trim()
          ? `${String(value.notes.trim().split(/\s+/).length)} words of notes`
          : "No notes yet"}
      </RecordStatus>
      <OpenFromDrive
        open={picking}
        onOpenChange={setPicking}
        kind="text"
        title="Notes from Drive"
        onChoose={(file) =>
          void readDriveText(file.id).then((result) => {
            if (result.ok) update((current) => ({ ...current, notes: result.data }));
          })
        }
      />
    </div>
  );
}
