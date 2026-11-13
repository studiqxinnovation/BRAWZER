import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { BackPressure } from "./back-pressure.js";

function socket() {
  const calls: string[] = [];
  return {
    calls,
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
  };
}

describe("relay back-pressure", () => {
  it("pauses the agent when a transfer's buffer is full and resumes once it drains", async () => {
    const agent = socket();
    const pressure = new BackPressure(agent);
    const body = new PassThrough({ highWaterMark: 16 });
    pressure.write("t1", body, Buffer.alloc(8));
    expect(agent.calls).toEqual([]);
    pressure.write("t1", body, Buffer.alloc(16));
    expect(agent.calls).toEqual(["pause"]);
    expect(pressure.paused).toBe(true);
    // More chunks while paused don't pause again.
    pressure.write("t1", body, Buffer.alloc(4));
    expect(pressure.pauses).toBe(1);
    // A reader drains the stream: the agent may go on.
    body.resume();
    await new Promise((resolve) => body.once("drain", resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(agent.calls).toEqual(["pause", "resume"]);
    expect(pressure.paused).toBe(false);
  });

  it("keeps the agent paused while any transfer is full", () => {
    const agent = socket();
    const pressure = new BackPressure(agent);
    const a = new PassThrough({ highWaterMark: 1 });
    const b = new PassThrough({ highWaterMark: 1 });
    pressure.write("a", a, Buffer.alloc(2));
    pressure.write("b", b, Buffer.alloc(2));
    expect(agent.calls).toEqual(["pause"]);
    pressure.release("a");
    expect(agent.calls).toEqual(["pause"]);
    pressure.release("b");
    expect(agent.calls).toEqual(["pause", "resume"]);
    pressure.releaseAll();
    expect(agent.calls).toEqual(["pause", "resume"]);
  });
});
