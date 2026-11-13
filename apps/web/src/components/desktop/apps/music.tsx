"use client";

import { useToast } from "@brawzer/ui/components/toast";
import { Pause, Play, SkipBack, SkipForward, Volume1 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppWindow } from "./app-window";
import { saveToDrive } from "./drive-save";
import { preview, useDriveKind } from "./media";
import { Tile } from "./registry";

const AUDIO = ".mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac,audio/*";

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
};

const title = (name: string) => name.replace(/\.[^.]+$/, "");

/**
 * Music, as the prototype's: the library down the side (the audio files in
 * your Drive), the song playing with its time, play and pause, back and
 * forward, and the volume. "Add songs…" uploads more into Drive's Music
 * folder, scanned and encrypted like any upload.
 */
export default function MusicApp() {
  const toast = useToast();
  const window = useAppWindow();
  const [version, setVersion] = useState(0);
  const tracks = useDriveKind("audio", version);
  const [playing, setPlaying] = useState<string | null>(window.params.file ?? null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState({ at: 0, length: 0 });
  const [volume, setVolume] = useState(0.7);
  const player = useRef<HTMLAudioElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const index = tracks?.findIndex((track) => track.id === playing) ?? -1;
  const current = index >= 0 ? tracks?.[index] : undefined;
  const { setTitle } = window;
  useEffect(() => {
    setTitle(current ? title(current.name) : null);
  }, [current, setTitle]);
  useEffect(() => {
    if (player.current) player.current.volume = volume;
  }, [volume, current]);

  const step = (by: number) => {
    if (!tracks || tracks.length === 0) return;
    const next = tracks[(Math.max(index, 0) + by + tracks.length) % tracks.length];
    if (next) setPlaying(next.id);
  };

  const toggle = () => {
    const audio = player.current;
    if (!current) {
      step(0);
      return;
    }
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  async function addSongs(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const result = await saveToDrive({
        name: file.name,
        content: file,
        type: file.type,
        folder: "Music",
      });
      if (!result.ok) {
        toast.add({
          type: "error",
          title: `Couldn’t add “${file.name}”`,
          description: result.error.message,
        });
      }
    }
    setVersion((value) => value + 1);
  }

  return (
    <div className="ap-body">
      <div className="ap-split">
        <nav className="ap-side" aria-label="Library">
          <span className="ap-side-h" aria-hidden="true">
            Library
          </span>
          {tracks?.length === 0 && <p className="ap-side-note">No songs in your Drive yet.</p>}
          <ol className="ap-tracks">
            {tracks?.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  className="ap-side-item"
                  aria-current={track.id === playing ? "true" : undefined}
                  onClick={() => {
                    setPlaying(track.id);
                  }}
                >
                  <Tile glyph="music" colour="purple" size={20} />
                  <span className="truncate">{title(track.name)}</span>
                </button>
              </li>
            ))}
          </ol>
          <span className="flex-1" />
          <button type="button" className="ap-side-add" onClick={() => picker.current?.click()}>
            + Add songs…
          </button>
          <input
            ref={picker}
            type="file"
            accept={AUDIO}
            multiple
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              void addSongs(event.target.files);
              event.target.value = "";
            }}
          />
        </nav>
        <div className="ap-player">
          <Tile glyph="music" colour="pink" size={150} />
          <div className="ap-player-t">
            <b>{current ? title(current.name) : "Nothing playing"}</b>
            <span>{current ? "From your Drive" : "Pick a song from your library"}</span>
          </div>
          <div className="ap-player-seek">
            <span>{clock(time.at)}</span>
            <input
              type="range"
              aria-label="Position"
              min={0}
              max={Math.max(1, time.length)}
              step={0.1}
              value={time.at}
              disabled={!current}
              onChange={(event) => {
                if (player.current) player.current.currentTime = Number(event.target.value);
              }}
            />
            <span>{clock(time.length)}</span>
          </div>
          <div className="ap-player-keys">
            <button
              type="button"
              className="ap-player-k"
              aria-label="Previous"
              onClick={() => {
                step(-1);
              }}
            >
              <SkipBack aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ap-player-k"
              data-main="true"
              aria-label={paused ? "Play" : "Pause"}
              onClick={toggle}
            >
              {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="ap-player-k"
              aria-label="Next"
              onClick={() => {
                step(1);
              }}
            >
              <SkipForward aria-hidden="true" />
            </button>
          </div>
          <label className="ap-player-vol">
            <Volume1 aria-hidden="true" />
            <span className="sr-only">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => {
                setVolume(Number(event.target.value));
              }}
            />
          </label>
          <p className="ap-player-note">Music keeps playing when you minimise this window.</p>
          {current && (
            // Your own audio files: there are no captions to offer.
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio
              key={current.id}
              ref={player}
              autoPlay
              src={preview(current)}
              onPlay={() => {
                setPaused(false);
              }}
              onPause={() => {
                setPaused(true);
              }}
              onTimeUpdate={(event) => {
                setTime({
                  at: event.currentTarget.currentTime,
                  length: event.currentTarget.duration,
                });
              }}
              onLoadedMetadata={(event) => {
                setTime({ at: 0, length: event.currentTarget.duration });
              }}
              onEnded={() => {
                if (tracks && tracks.length > 1) step(1);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
