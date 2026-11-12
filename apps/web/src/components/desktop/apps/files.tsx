"use client";

import type { DriveFile, DriveFolder, DriveUsage } from "@brawzer/contracts";
import { DRIVE_TRASH_DAYS } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { ArrowLeft, RotateCcw, Search, Trash2 } from "lucide-react";
import { readDesktopPrefs, updateDesktopPrefs } from "@/lib/desktop-prefs";
import { notify } from "@/lib/notifications";
import { rememberRecentFile } from "@/lib/recent-files";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createFolder,
  deleteFile,
  deleteForever,
  emptyTrash,
  fetchDriveOverview,
  fetchTrash,
  listDriveFiles,
  restoreFile,
  updateFile,
  uploadDriveFile,
} from "@/lib/api/drive";
import { useAppWindow } from "./app-window";
import { fileTile } from "../desktop-icons";
import type { GlyphName, TileColour } from "../glyphs";
import { appFor } from "./open-with";
import { apps, Tile } from "./registry";

type Place =
  { kind: "folder"; id: string | null } | { kind: "trash" } | { kind: "search"; q: string };

const size = (bytes: number) =>
  bytes < 1024
    ? `${String(bytes)} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A folder's tile, as the prototype colours Drive's folders by what they hold. */
const FOLDER_TILES: Record<string, [GlyphName, TileColour]> = {
  desktop: ["grid", "indigo"],
  documents: ["doc", "blue"],
  downloads: ["folder", "teal"],
  photos: ["image", "pink"],
  pictures: ["image", "pink"],
  screenshots: ["camera", "purple"],
  music: ["music", "pink"],
  notes: ["note", "yellow"],
  spreadsheets: ["table", "green"],
  invoices: ["doc", "green"],
  uploads: ["folder", "orange"],
  code: ["code", "indigo"],
};
const folderTile = (name: string, size: number) => {
  const [glyph, colour] = FOLDER_TILES[name.toLowerCase()] ?? ["folder", "blue"];
  return <Tile glyph={glyph} colour={colour} size={size} />;
};
const fileIcon = (file: DriveFile, size: number) => {
  const { glyph, colour } = fileTile(file.name, file.contentType);
  return <Tile glyph={glyph} colour={colour} size={size} />;
};

const STARTING_FOLDERS = ["Desktop", "Documents", "Downloads", "Photos", "Screenshots", "Uploads"];
const WELCOME = `Welcome to your cloud computer.

Try these:
- Right-click the desktop, a file, a dock icon or a window
- Drag a window to the edge of the screen to snap it
- Drop files from your computer onto the desktop to upload them
- Get web apps and whole packs from the App Store
- Add extensions to each browser on the Extensions page

Everything runs in the cloud. Nothing stays on this computer.
`;

/** Drive's starting folders and the welcome note, made once for an account with an empty Drive. */
async function setUpDrive(): Promise<void> {
  let desktop: string | null = null;
  for (const name of STARTING_FOLDERS) {
    const made = await createFolder({ name, parentId: null, space: "personal" });
    if (made.ok && name === "Desktop") desktop = made.data.id;
  }
  if (desktop) {
    const note = new File([WELCOME], "Welcome to Brawzer.txt", { type: "text/plain" });
    await uploadDriveFile(note, desktop, () => undefined).result;
  }
  updateDesktopPrefs({ driveSetUp: true });
}

/**
 * Files (and Trash): Drive as a file manager. Folders down the side, the
 * place's folders and files, opening each file in the app that shows it,
 * renaming, uploading from this computer, and Trash with "Put back".
 */
export function FilesBrowser({ start }: { start: "drive" | "trash" }) {
  const toast = useToast();
  const window = useAppWindow();
  const [place, setPlace] = useState<Place>(
    start === "trash" ? { kind: "trash" } : { kind: "folder", id: window.params.folder ?? null },
  );
  const [folders, setFolders] = useState<readonly DriveFolder[]>([]);
  const [usage, setUsage] = useState<DriveUsage | null>(null);
  const [files, setFiles] = useState<readonly DriveFile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.params.search) searchBox.current?.focus();
  }, [window.params.search]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const { setTitle } = window;

  // Read again after each change made here.
  const [version, setVersion] = useState(0);
  const load = useCallback(() => {
    setVersion((current) => current + 1);
    // The desktop's icons show the Desktop folder: told to look again.
    globalThis.dispatchEvent(new Event("brawzer:drive-changed"));
  }, [setVersion]);

  // The first time Drive is opened as a computer: the prototype's folders and its welcome note.
  const settingUp = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchDriveOverview(),
      place.kind === "trash"
        ? fetchTrash()
        : place.kind === "search"
          ? listDriveFiles({ q: place.q })
          : listDriveFiles({ folderId: place.id }),
    ]).then(([overview, listed]) => {
      if (cancelled) return;
      if (overview.ok) {
        setFolders(overview.data.folders);
        setUsage(overview.data.usage);
        if (
          !settingUp.current &&
          !readDesktopPrefs().driveSetUp &&
          overview.data.folders.length === 0 &&
          overview.data.usage.fileCount === 0
        ) {
          settingUp.current = true;
          void setUpDrive().then(load);
        }
      }
      setFiles(listed.ok ? listed.data.files : []);
    });
    return () => {
      cancelled = true;
    };
  }, [place, version, load]);

  const folderName = (id: string | null) =>
    id === null ? "All files" : (folders.find((folder) => folder.id === id)?.name ?? "Folder");
  const here =
    place.kind === "trash"
      ? "Trash"
      : place.kind === "search"
        ? `“${place.q}”`
        : folderName(place.id);
  useEffect(() => {
    setTitle(here);
  }, [here, setTitle]);

  const inside =
    place.kind === "folder" ? folders.filter((folder) => folder.parentId === place.id) : [];
  const depthOf = (folder: DriveFolder): number => {
    let depth = 0;
    let parent = folder.parentId;
    while (parent && depth < 8) {
      depth += 1;
      parent = folders.find((candidate) => candidate.id === parent)?.parentId ?? null;
    }
    return depth;
  };
  const tree = (parent: string | null): DriveFolder[] =>
    folders
      .filter((folder) => folder.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((folder) => [folder, ...tree(folder.id)]);

  function openFile(file: DriveFile) {
    const app = appFor(file);
    if (!app) {
      toast.add({
        type: "info",
        title: "No app here opens this kind of file",
        description: "Open Drive in Brawzer’s window to save it to this computer.",
      });
      return;
    }
    rememberRecentFile({
      id: file.id,
      name: file.name,
      contentType: file.contentType,
      status: file.status,
    });
    window.openApp(app, { file: file.id, name: file.name });
  }

  async function moveToTrash(file: DriveFile) {
    const result = await deleteFile(file.id);
    if (!result.ok) {
      toast.add({ type: "error", title: "Couldn’t delete it", description: result.error.message });
      return;
    }
    toast.add({
      type: "success",
      title: file.status === "clean" ? `“${file.name}” is in Trash` : `“${file.name}” deleted`,
      description:
        file.status === "clean"
          ? `Kept ${String(DRIVE_TRASH_DAYS)} days, then removed.`
          : undefined,
    });
    setSelected(null);
    load();
  }

  async function rename(file: DriveFile, name: string) {
    setRenaming(null);
    if (!name.trim() || name === file.name) return;
    const result = await updateFile(file.id, { name: name.trim() });
    if (!result.ok)
      toast.add({ type: "error", title: "Couldn’t rename it", description: result.error.message });
    load();
  }

  async function makeFolder(name: string) {
    setNewFolder(null);
    if (!name.trim() || place.kind !== "folder") return;
    const result = await createFolder({ name: name.trim(), parentId: place.id, space: "personal" });
    if (!result.ok)
      toast.add({
        type: "error",
        title: "Couldn’t make the folder",
        description: result.error.message,
      });
    load();
  }

  async function uploadFiles(list: FileList | null) {
    if (!list || place.kind !== "folder") return;
    for (const file of Array.from(list)) {
      const result = await uploadDriveFile(file, place.id, () => undefined).result;
      if (result.ok && result.data.status === "clean") {
        const uploaded = result.data;
        notify({
          source: "Files · Drive",
          glyph: "folder",
          colour: "blue",
          tone: "success",
          title: `Uploaded “${uploaded.name}”`,
          description: "It’s in your Drive, encrypted with its own key.",
          action: { label: "Open", run: () => openFile(uploaded) },
        });
      }
      toast.add(
        result.ok
          ? result.data.status === "clean"
            ? { type: "success", title: `Uploaded “${result.data.name}”` }
            : {
                type: "error",
                title: `“${result.data.name}” was quarantined`,
                description: "It matched known malware.",
              }
          : {
              type: "error",
              title: `Couldn’t upload “${file.name}”`,
              description: result.error.message,
            },
      );
    }
    load();
  }

  const current = files?.find((file) => file.id === selected) ?? null;
  const trash = place.kind === "trash";

  return (
    <div className="ap-body">
      <div className="ap-split">
        <nav className="ap-side" aria-label="Places">
          <span className="ap-side-h" aria-hidden="true">
            Drive
          </span>
          <button
            type="button"
            className="ap-side-item"
            aria-current={place.kind === "folder" && place.id === null ? "page" : undefined}
            onClick={() => {
              setPlace({ kind: "folder", id: null });
            }}
          >
            <Tile glyph="folder" colour="blue" size={20} />
            All files
          </button>
          {tree(null).map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="ap-side-item"
              style={{ paddingLeft: `${String(0.55 + depthOf(folder) * 0.85)}rem` }}
              aria-current={place.kind === "folder" && place.id === folder.id ? "page" : undefined}
              onClick={() => {
                setPlace({ kind: "folder", id: folder.id });
              }}
            >
              {folderTile(folder.name, 20)}
              <span className="truncate">{folder.name}</span>
            </button>
          ))}
          <button
            type="button"
            className="ap-side-item"
            aria-current={trash ? "page" : undefined}
            onClick={() => {
              setPlace({ kind: "trash" });
            }}
          >
            <Tile glyph="trash" colour="gray" size={20} />
            Trash
          </button>
          {usage && (
            <div className="ap-usage">
              <span className="ap-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${String(Math.min(100, (usage.usedBytes / usage.limitBytes) * 100))}%`,
                  }}
                />
              </span>
              <span>
                {size(usage.usedBytes)} of {size(usage.limitBytes)}
              </span>
            </div>
          )}
        </nav>
        <div className="ap-col">
          <div className="ap-toolbar">
            <button
              type="button"
              className="ap-tool"
              aria-label="Up one folder"
              disabled={!(place.kind === "folder" && place.id !== null) && place.kind !== "search"}
              onClick={() => {
                if (place.kind === "search") setPlace({ kind: "folder", id: null });
                else if (place.kind === "folder" && place.id) {
                  setPlace({
                    kind: "folder",
                    id: folders.find((folder) => folder.id === place.id)?.parentId ?? null,
                  });
                }
              }}
            >
              <ArrowLeft aria-hidden="true" />
            </button>
            <h2 className="ap-place">{here}</h2>
            <span className="flex-1" />
            <form
              method="post"
              role="search"
              className="ap-search"
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim()) setPlace({ kind: "search", q: query.trim() });
              }}
            >
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor={`${window.id}-search`}>
                Search Drive
              </label>
              <input
                ref={searchBox}
                id={`${window.id}-search`}
                type="search"
                value={query}
                placeholder="Search"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </form>
            <span className="ap-segment" role="radiogroup" aria-label="View">
              <button
                type="button"
                role="radio"
                aria-checked={view === "grid"}
                onClick={() => {
                  setView("grid");
                }}
              >
                Icons
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={view === "list"}
                onClick={() => {
                  setView("list");
                }}
              >
                List
              </button>
            </span>
            {!trash && (
              <>
                <Button
                  size="sm"
                  disabled={place.kind !== "folder"}
                  onClick={() => {
                    setNewFolder("");
                  }}
                >
                  New folder
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={place.kind !== "folder"}
                  onClick={() => upload.current?.click()}
                >
                  Upload
                </Button>
                <input
                  ref={upload}
                  type="file"
                  multiple
                  hidden
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) => {
                    void uploadFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </>
            )}
            {trash && (
              <Button
                size="sm"
                variant="danger"
                disabled={!files || files.length === 0}
                onClick={() =>
                  void emptyTrash().then((result) => {
                    toast.add(
                      result.ok
                        ? { type: "success", title: "Trash emptied" }
                        : {
                            type: "error",
                            title: "Couldn’t empty Trash",
                            description: result.error.message,
                          },
                    );
                    load();
                  })
                }
              >
                <Trash2 aria-hidden="true" />
                Empty Trash
              </Button>
            )}
          </div>
          <div className="ap-main ap-files-main">
            {trash && (
              <p className="ap-note">
                Files stay here {DRIVE_TRASH_DAYS} days, then they’re removed for good. They count
                towards your storage until then.
              </p>
            )}
            {newFolder !== null && (
              <form
                method="post"
                className="ap-row ap-new-folder"
                onSubmit={(event) => {
                  event.preventDefault();
                  void makeFolder(newFolder);
                }}
              >
                <label className="ap-field ap-inline">
                  <span>New folder</span>
                  <input
                    className="ap-input"
                    // The name field is what was asked for.
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={newFolder}
                    onChange={(event) => {
                      setNewFolder(event.target.value);
                    }}
                  />
                </label>
                <Button size="sm" type="submit" variant="primary">
                  Make
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setNewFolder(null);
                  }}
                >
                  Cancel
                </Button>
              </form>
            )}
            {files === null ? null : inside.length === 0 && files.length === 0 ? (
              <p className="ap-empty">
                {trash
                  ? "Trash is empty."
                  : place.kind === "search"
                    ? "Nothing matches."
                    : "This folder is empty."}
              </p>
            ) : (
              <ul
                className={view === "grid" ? "ap-file-grid" : "ap-file-list"}
                aria-label={`In ${here}`}
              >
                {inside.map((folder) => (
                  <li key={folder.id}>
                    <button
                      type="button"
                      className="ap-file"
                      onDoubleClick={() => {
                        setPlace({ kind: "folder", id: folder.id });
                      }}
                      onClick={() => {
                        setSelected(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setPlace({ kind: "folder", id: folder.id });
                      }}
                      aria-label={`${folder.name}, folder`}
                    >
                      <span className="ap-file-icon" data-folder="true">
                        {folderTile(folder.name, view === "grid" ? 48 : 20)}
                      </span>
                      <span className="ap-file-name">{folder.name}</span>
                      {view === "list" && <span className="ap-file-meta">Folder</span>}
                    </button>
                  </li>
                ))}
                {files.map((file) => {
                  const opener = appFor(file);
                  return (
                    <li key={file.id}>
                      {renaming === file.id ? (
                        <form
                          method="post"
                          className="ap-rename"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const input = event.currentTarget.elements.namedItem("name");
                            void rename(
                              file,
                              input instanceof HTMLInputElement ? input.value : file.name,
                            );
                          }}
                        >
                          <label className="sr-only" htmlFor={`${file.id}-name`}>
                            New name for {file.name}
                          </label>
                          <input
                            id={`${file.id}-name`}
                            name="name"
                            className="ap-input"
                            defaultValue={file.name}
                            // Renaming is what was asked for.
                            // eslint-disable-next-line jsx-a11y/no-autofocus
                            autoFocus
                            onBlur={(event) => void rename(file, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setRenaming(null);
                            }}
                          />
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="ap-file"
                          aria-pressed={selected === file.id}
                          aria-label={`${file.name}, ${size(file.size)}${file.status === "clean" ? "" : ", quarantined"}`}
                          onClick={() => {
                            setSelected(file.id);
                          }}
                          onDoubleClick={() => {
                            if (!trash) openFile(file);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !trash) openFile(file);
                            if ((event.key === "Delete" || event.key === "Backspace") && !trash)
                              void moveToTrash(file);
                          }}
                        >
                          <span
                            className="ap-file-icon"
                            data-quarantined={file.status !== "clean" || undefined}
                          >
                            {file.previewable &&
                            file.contentType.startsWith("image/") &&
                            view === "grid" ? (
                              // A Drive preview: same origin, served so it can't run.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`/api/v1/drive/files/${file.id}/preview`}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              fileIcon(file, view === "grid" ? 48 : 20)
                            )}
                          </span>
                          <span className="ap-file-name">{file.name}</span>
                          {view === "list" && (
                            <span className="ap-file-meta">
                              {size(file.size)} · {opener ? apps[opener].name : "No app"} ·{" "}
                              {new Date(
                                trash && file.trashedAt ? file.trashedAt : file.updatedAt,
                              ).toLocaleDateString()}
                            </span>
                          )}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="ap-statusbar">
            <span>
              {current
                ? `${current.name} · ${size(current.size)}`
                : `${String((files?.length ?? 0) + inside.length)} items · ${size((files ?? []).reduce((total, file) => total + file.size, 0))}`}
            </span>
            <span className="ap-row">
              {!current && !trash && (files?.length ?? 0) > 0 && "Double-click a file to open it"}
              {current && !trash && (
                <>
                  <button
                    type="button"
                    className="ap-text-button"
                    disabled={!appFor(current)}
                    onClick={() => {
                      openFile(current);
                    }}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="ap-text-button"
                    onClick={() => {
                      setRenaming(current.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="ap-text-button"
                    onClick={() => {
                      window.openApp("send-to-phone", { file: current.id, name: current.name });
                    }}
                  >
                    Send to Phone
                  </button>
                  <button
                    type="button"
                    className="ap-text-button"
                    onClick={() => void moveToTrash(current)}
                  >
                    Move to Trash
                  </button>
                </>
              )}
              {current && trash && (
                <>
                  <button
                    type="button"
                    className="ap-text-button"
                    onClick={() =>
                      void restoreFile(current.id).then((result) => {
                        toast.add(
                          result.ok
                            ? {
                                type: "success",
                                title: `“${result.data.name}” is back`,
                                description: `In ${folderName(result.data.folderId)}.`,
                              }
                            : {
                                type: "error",
                                title: "Couldn’t put it back",
                                description: result.error.message,
                              },
                        );
                        setSelected(null);
                        load();
                      })
                    }
                  >
                    <RotateCcw aria-hidden="true" className="inline size-3" /> Put back
                  </button>
                  <button
                    type="button"
                    className="ap-text-button"
                    onClick={() =>
                      void deleteForever(current.id).then(() => {
                        setSelected(null);
                        load();
                      })
                    }
                  >
                    Delete for good
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FilesApp() {
  return <FilesBrowser start="drive" />;
}
