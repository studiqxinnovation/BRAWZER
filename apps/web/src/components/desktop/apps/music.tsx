"use client";

import { Music2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppWindow } from "./app-window";
import { preview, useDriveKind } from "./media";

/** Music: plays the audio files in your Drive, one after another. */
export default function MusicApp() {
  const window = useAppWindow();
  const tracks = useDriveKind("audio");
  const [playing, setPlaying] = useState<string | null>(window.params.file ?? null);
  const player = useRef<HTMLAudioElement>(null);
  const index = tracks?.findIndex((track) => track.id === playing) ?? -1;
  const current = index >= 0 ? tracks?.[index] : undefined;
  const { setTitle } = window;
  useEffect(() => {
    setTitle(current ? current.name : null);
  }, [current, setTitle]);

  return (
    <div className="ap-body">
      <div className="ap-now">
        <span className="ap-now-art" aria-hidden="true">
          <Music2 />
        </span>
        <div className="ap-now-main">
          <b>{current ? current.name.replace(/\.[^.]+$/, "") : "Nothing playing"}</b>
          <span>{current ? "From your Drive" : "Choose a track below."}</span>
          {current && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio
              key={current.id}
              ref={player}
              className="ap-audio"
              controls
              autoPlay
              src={preview(current)}
              onEnded={() => {
                if (tracks && tracks.length > 1)
                  setPlaying(tracks[(index + 1) % tracks.length]?.id ?? null);
              }}
            />
          )}
        </div>
      </div>
      <div className="ap-main">
        {tracks?.length === 0 ? (
          <p className="ap-empty">
            No music in Drive yet. Upload MP3, M4A, OGG, WAV or FLAC files in Files.
          </p>
        ) : (
          <ol className="ap-tracks" aria-label="Tracks">
            {tracks?.map((track, at) => (
              <li key={track.id}>
                <button
                  type="button"
                  className="ap-track"
                  aria-current={track.id === playing ? "true" : undefined}
                  onClick={() => {
                    setPlaying(track.id);
                  }}
                >
                  <span className="ap-track-number">
                    {track.id === playing ? <Play aria-hidden="true" /> : at + 1}
                  </span>
                  <span className="truncate">{track.name.replace(/\.[^.]+$/, "")}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
