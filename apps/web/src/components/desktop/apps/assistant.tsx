"use client";

import { Button } from "@brawzer/ui/components/button";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { askAssistant, fetchAssistantStatus } from "@/lib/api/assistant";
import { Tile } from "./registry";

const IDEAS = [
  "Write a polite email asking for a day off",
  "Explain compound interest simply",
  "Make a weekly shopping list",
  "How do I stay safe on a shared computer?",
];

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

  const off = available === false;

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
            <Tile glyph="sparkle" colour="purple" size={52} />
            <h2>Hi, how can I help?</h2>
            <p>
              I can write, explain and plan. What you write goes to Claude, by Anthropic, to answer
              it; Brawzer doesn’t keep the conversation.
            </p>
            <div className="ap-chat-ideas">
              {IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  className="ap-chat-idea"
                  disabled={off || available === null}
                  onClick={() => {
                    setDraft(idea);
                  }}
                >
                  {idea}
                </button>
              ))}
            </div>
            {off && (
              <p className="ap-chat-off">
                The assistant isn’t turned on for this Brawzer. Its operator can turn it on.
              </p>
            )}
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
          rows={1}
          value={draft}
          placeholder="Ask anything, or ask me to write something for you"
          disabled={available !== true}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <span className="ap-row">
          {turns.length > 0 && (
            <Button
              size="sm"
              disabled={waiting}
              onClick={() => {
                setTurns([]);
                setFailure(null);
              }}
            >
              New
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={waiting}
            disabled={!draft.trim() || available !== true}
          >
            Send
          </Button>
        </span>
      </form>
    </div>
  );
}
