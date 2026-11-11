import { z } from "zod";

/**
 * The Assistant and Study Notes (Phase 9): answers from Claude, through
 * Brawzer's API, only when the operator has set a key. Brawzer doesn't keep
 * the conversation; Study Notes keeps what the person saves, as app records.
 */
export const ASSISTANT_LIMITS = {
  messages: 40,
  messageChars: 20_000,
  notesChars: 60_000,
} as const;

export const assistantStatusSchema = z.object({
  /** False until the operator sets ANTHROPIC_API_KEY. */
  available: z.boolean(),
});

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(
      ASSISTANT_LIMITS.messageChars,
      `A message can be up to ${String(ASSISTANT_LIMITS.messageChars)} characters.`,
    ),
});

export const assistantChatRequestSchema = z.object({
  messages: z
    .array(turnSchema)
    .min(1, "Write something first.")
    .max(ASSISTANT_LIMITS.messages, "This conversation is long: start a new one.")
    .refine((messages) => messages[0]?.role === "user" && messages.at(-1)?.role === "user", {
      error: "A conversation starts and ends with your message.",
    }),
});

export const assistantChatResponseSchema = z.object({
  reply: z.string(),
  /** Claude declined to answer; `reply` says so. */
  declined: z.boolean(),
});

export const studyKinds = ["summary", "flashcards", "quiz"] as const;
export const studyKindSchema = z.enum(studyKinds);

export const studyRequestSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(40, "Paste at least a few sentences of notes.")
    .max(
      ASSISTANT_LIMITS.notesChars,
      `Notes can be up to ${String(ASSISTANT_LIMITS.notesChars)} characters.`,
    ),
  kind: studyKindSchema,
});

export const flashcardSchema = z.object({ front: z.string(), back: z.string() });
export const quizQuestionSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).min(2),
  /** The right choice's index. */
  answer: z.number().int().nonnegative(),
  explanation: z.string(),
});

export const studyResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary"), title: z.string(), points: z.array(z.string()) }),
  z.object({ kind: z.literal("flashcards"), cards: z.array(flashcardSchema) }),
  z.object({ kind: z.literal("quiz"), questions: z.array(quizQuestionSchema) }),
]);

export type AssistantChatResponse = z.infer<typeof assistantChatResponseSchema>;
export type StudyResult = z.infer<typeof studyResultSchema>;
export type StudyKind = z.infer<typeof studyKindSchema>;
