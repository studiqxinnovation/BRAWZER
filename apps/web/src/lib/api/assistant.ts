import {
  assistantChatResponseSchema,
  assistantStatusSchema,
  type StudyKind,
  studyResultSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const fetchAssistantStatus = () =>
  apiRequest("/assistant", { schema: assistantStatusSchema });

export const askAssistant = (
  messages: readonly { role: "user" | "assistant"; content: string }[],
) =>
  apiRequest("/assistant/chat", {
    method: "POST",
    body: { messages },
    schema: assistantChatResponseSchema,
  });

export const studyFromNotes = (notes: string, kind: StudyKind) =>
  apiRequest("/assistant/study", {
    method: "POST",
    body: { notes, kind },
    schema: studyResultSchema,
  });
