"use client";

import { Button } from "@brawzer/ui/components/button";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { askAssistant, fetchAssistantStatus } from "@/lib/api/assistant";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The Assistant: a conversation with Claude, through Brawzer's API, when the
 * operator has turned it on. Brawzer keeps none of it; closing the window
 * clears it.
 */
export default function AssistantApp() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchAssistantStatus().then((result) => {
      setAvailable(result.ok && result.data.available);
    });
  }, []);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns, waiting]);

  async function send() {
    const content = draft.trim();
    if (!content || waiting) return;
    const next = [...turns, { role: "user" as const, content }];
    setTurns(next);
    setDraft("");
    setFailure(null);
    setWaiting(true);
    const result = await askAssistant(next.slice(-40));
    setWaiting(false);
    if (result.ok) {
      setTurns([...next, { role: "assistant", content: result.data.reply }]);
    } else {
      setFailure(
        result.status === 429
          ? "That’s a lot of questions this hour. Try again a little later."
          : "Claude couldn’t answer just now. Try again in a moment.",
      );
      setTurns(turns);
      setDraft(content);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  if (available === false) {
    return (
      <div className="ap-body">
        <div className="ap-empty">
          <Sparkles aria-hidden="true" className="size-8" />
          <p>The assistant isn’t turned on for this Brawzer. Its operator can turn it on.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ap-body ap-chat">
      <div
        ref={log}
        className="ap-chat-log"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {turns.length === 0 && (
          <div className="ap-chat-hello">
            <span className="ap-chat-mark" aria-hidden="true">
              <Sparkles />
            </span>
            <h2>What can I help with?</h2>
            <p>
              Ask about anything: an idea to explain, an email to write, a plan to make. What you
              write goes to Claude, by Anthropic, to answer it; Brawzer doesn’t keep the
              conversation.
            </p>
          </div>
        )}
        {turns.map((turn, index) => (
          <div key={index} className="ap-bubble" data-role={turn.role}>
            <span className="sr-only">{turn.role === "user" ? "You:" : "Assistant:"}</span>
            {turn.content}
          </div>
        ))}
        {waiting && (
          <div className="ap-bubble ap-typing" data-role="assistant" aria-label="Thinking">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      {failure && (
        <p className="ap-error ap-chat-failure" role="alert">
          {failure}
        </p>
      )}
      <form
        method="post"
        className="ap-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="assistant-message">
          Message
        </label>
        <textarea
          id="assistant-message"
          className="ap-input ap-chat-input"
          rows={2}
          value={draft}
          placeholder="Message the assistant"
          disabled={available === null}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="flex flex-col gap-1.5">
          <Button
            type="submit"
            variant="primary"
            size="icon"
            aria-label="Send"
            loading={waiting}
            disabled={!draft.trim()}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="New conversation"
            disabled={turns.length === 0 || waiting}
            onClick={() => {
              setTurns([]);
              setFailure(null);
            }}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  );
}
