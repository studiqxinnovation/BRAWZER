import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  assistantChatResponseSchema,
  assistantStatusSchema,
  studyResultSchema,
} from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";

// A stand-in for Claude's Messages API: it records each request and answers
// with whatever the test queued.
interface Seen {
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}
const seen: Seen[] = [];
let next: { status: number; body: unknown }[] = [];
let stub: Server;

const message = (content: unknown[], stopReason = "end_turn") => ({
  status: 200,
  body: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 8 },
  },
});

let h: Harness;
let off: Harness;

beforeAll(async () => {
  stub = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      seen.push({
        headers: request.headers,
        body: JSON.parse(raw || "{}") as Record<string, unknown>,
      });
      const answer = next.shift() ?? message([{ type: "text", text: "Nothing queued." }]);
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const { port } = stub.address() as AddressInfo;
  h = await createHarness({
    ipPrefix: "100.73.0",
    env: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(port)}` },
  });
  off = await createHarness({ ipPrefix: "100.73.1", env: { ANTHROPIC_API_KEY: undefined } });
});

afterAll(async () => {
  await h.close();
  await off.close();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

describe("the assistant", () => {
  it("is off, and says so, until the operator sets a key", async () => {
    const client = off.browser();
    await off.signUp(client, off.uniqueEmail("assistant-off"));
    expect(assistantStatusSchema.parse((await client.get("/assistant")).json())).toEqual({
      available: false,
    });
    const refused = await client.post("/assistant/chat", {
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(refused.statusCode).toBe(503);
    expect(off.errorOf(refused).code).toBe("service_unavailable");
  });

  it("asks Claude with the conversation, and handles a refusal and a refused key", async () => {
    const client = h.browser();
    await h.signUp(client, h.uniqueEmail("assistant"));
    expect(assistantStatusSchema.parse((await client.get("/assistant")).json())).toEqual({
      available: true,
    });

    next = [message([{ type: "text", text: "Mitochondria make energy for the cell." }])];
    const answered = await client.post("/assistant/chat", {
      messages: [
        { role: "user", content: "What do mitochondria do?" },
        { role: "assistant", content: "Do you mean in animal cells?" },
        { role: "user", content: "Yes" },
      ],
    });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(assistantChatResponseSchema.parse(answered.json())).toEqual({
      reply: "Mitochondria make energy for the cell.",
      declined: false,
    });
    const request = seen.at(-1);
    expect(request?.headers.authorization).toBe("Bearer test-key");
    expect(String(request?.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(request?.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default" });
    expect((request?.body.messages as unknown[]).length).toBe(3);
    expect(JSON.stringify(request?.body.system)).toContain("assistant inside Brawzer");

    next = [message([], "refusal")];
    const declined = assistantChatResponseSchema.parse(
      (
        await client.post("/assistant/chat", {
          messages: [{ role: "user", content: "Something it won't do" }],
        })
      ).json(),
    );
    expect(declined.declined).toBe(true);

    next = [
      {
        status: 401,
        body: {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        },
      },
    ];
    const broken = await client.post("/assistant/chat", {
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(broken.statusCode).toBe(503);
    expect(h.errorOf(broken).code).toBe("service_unavailable");

    // A conversation has to end with the person's message.
    const backwards = await client.post("/assistant/chat", {
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
    });
    expect(backwards.statusCode).toBe(400);
  });

  it("turns notes into a quiz, keeping only questions whose answer is one of the choices", async () => {
    const client = h.browser();
    await h.signUp(client, h.uniqueEmail("study"));
    const quiz = {
      questions: [
        {
          question: "What is 2 + 2?",
          choices: ["3", "4", "5", "6"],
          answer: 1,
          explanation: "Two and two make four.",
        },
        { question: "Broken", choices: ["a", "b"], answer: 7, explanation: "Points nowhere." },
      ],
    };
    next = [message([{ type: "text", text: JSON.stringify(quiz) }])];
    const response = await client.post("/assistant/study", {
      kind: "quiz",
      notes: "Arithmetic: adding two and two gives four. Adding three and three gives six.",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(studyResultSchema.parse(response.json())).toEqual({
      kind: "quiz",
      questions: [quiz.questions[0]],
    });
    const request = seen.at(-1);
    expect(JSON.stringify(request?.body.messages)).toContain("<notes>");
    expect(JSON.stringify(request?.body.output_config)).toContain("json_schema");
    expect(
      (await client.post("/assistant/study", { kind: "quiz", notes: "Too short" })).statusCode,
    ).toBe(400);
  });
});
