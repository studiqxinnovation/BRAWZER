"use client";

import { readDesktopPrefs } from "./desktop-prefs";

/**
 * The desktop's little sounds, made in the page (no files), as the
 * prototype has them: a click when a window opens, a pop, the trash, a
 * shutter for a screenshot, a chime for a notice, and the start-up chord.
 * Off with Sounds off, quiet with the volume, and notices are silent in
 * Do Not Disturb.
 */
export type Sound = "click" | "pop" | "trash" | "shot" | "note" | "boot";

const SHAPES: Record<Sound, [number, number, OscillatorType]> = {
  click: [880, 0.05, "triangle"],
  pop: [660, 0.1, "sine"],
  trash: [300, 0.28, "sawtooth"],
  shot: [1400, 0.07, "square"],
  note: [988, 0.35, "sine"],
  boot: [523, 1, "sine"],
};

let context: AudioContext | null = null;

export function playSound(kind: Sound) {
  const { sounds, volume, dnd } = readDesktopPrefs();
  if (!sounds || volume === 0 || (dnd && kind === "note")) return;
  try {
    context ??= new AudioContext();
    const [frequency, length, type] = SHAPES[kind];
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    const now = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (kind === "trash") oscillator.frequency.exponentialRampToValueAtTime(70, now + length);
    if (kind === "boot") {
      oscillator.frequency.setValueAtTime(392, now);
      oscillator.frequency.setValueAtTime(523, now + 0.22);
      oscillator.frequency.setValueAtTime(784, now + 0.44);
    }
    if (kind === "note") oscillator.frequency.setValueAtTime(1319, now + 0.12);
    gain.gain.setValueAtTime((volume / 100) * 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + length + 0.03);
  } catch {
    // No audio here: the desktop works the same without its sounds.
  }
}
