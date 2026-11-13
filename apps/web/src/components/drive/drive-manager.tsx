"use client";

import type { DriveFile, DriveFolder, DriveUsage } from "@brawzer/contracts";
import { Badge } from "@brawzer/ui/components/badge";
import { Button } from "@brawzer/ui/components/button";
import { EmptyState } from "@brawzer/ui/components/empty-state";
import { Input } from "@brawzer/ui/components/field";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@brawzer/ui/components/menu";
import { useToast } from "@brawzer/ui/components/toast";
import {
  ChevronRight,
  Download,
  Ellipsis,
  Eye,
  File,
  FileImage,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  HardDriveDownload,
  Pencil,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";
import { Panel } from "@/components/app-shell/page";
import type { ApiResult } from "@/lib/api/client";
import { createFolder, deleteFile, deleteFolder, updateFile, updateFolder } from "@/lib/api/drive";
import {
  childFolders,
  describePath,
  describeType,
  folderPath,
  formatBytes,
  previewKind,
  shortName,
} from "@/lib/drive";
import { timeAgo } from "@/lib/time";
import { DeleteDialog, MoveDialog, NameDialog } from "./dialogs";
import { PreviewDialog } from "./preview-dialog";
import { SaveToComputerDialog } from "./save-to-computer";
import { UploadButton, UploadList, useUploads } from "./uploads";

const folderHref = (folderId: string | null) =>
  folderId ? ({ pathname: "/app/drive", query: { folder: folderId } } as const) : "/app/drive";

function FileIcon({ file }: { file: DriveFile }) {
  const className = "size-4 shrink-0 text-ink-tertiary";
  if (file.status === "infected")
    return <ShieldAlert aria-hidden className="size-4 shrink-0 text-danger" />;
  if (file.contentType.startsWith("image/")) return <FileImage aria-hidden className={className} />;
  if (file.contentType === "text/plain" || file.contentType === "application/pdf") {
    return <FileText aria-hidden className={className} />;
  }
  return <File aria-hidden className={className} />;
}

type FileAction = "preview" | "save" | "rename" | "move" | "delete" | null;
type FolderAction = "rename" | "move" | "delete" | null;

function FileRow({
  file,
  folders,
  showLocation,
  sharedComputer,
  renderedAt,
  onChanged,
}: {
  file: DriveFile;
  folders: readonly DriveFolder[];
  showLocation: boolean;
  sharedComputer: boolean;
  renderedAt: number;
  onChanged: (message: string) => void;
}) {
  const [action, setAction] = useState<FileAction>(null);
  const kind = previewKind(file);
  const quarantined = file.status === "infected";
  const close = (open: boolean) => {
    if (!open) setAction(null);
  };
  const after = (message: string) => (result: ApiResult<unknown>) => {
    if (result.ok) onChanged(message);
    return result;
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <FileIcon file={file} />
      <div className="min-w-0 flex-1">
        {kind ? (
          <button
            type="button"
            className="block max-w-full truncate rounded-sm text-left text-callout font-medium text-ink outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={() => {
              setAction("preview");
            }}
          >
            {file.name}
          </button>
        ) : (
          <p className="truncate text-callout font-medium text-ink">{file.name}</p>
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 text-footnote text-ink-secondary">
          {quarantined && (
            <Badge tone="danger">
              <ShieldAlert aria-hidden="true" />
              Quarantined
            </Badge>
          )}
          <span>{describeType(file.contentType)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatBytes(file.size)}</span>
          <span aria-hidden="true">·</span>
          <span>added {timeAgo(file.createdAt, renderedAt)}</span>
          {showLocation && (
            <>
              <span aria-hidden="true">·</span>
              <span>in {describePath(folders, file.folderId)}</span>
            </>
          )}
        </p>
        {quarantined && (
          <p className="mt-0.5 text-footnote text-danger">
            The malware scan found {file.threat ?? "a threat"}. It can’t be opened or saved, only
            deleted.
          </p>
        )}
      </div>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="sm" aria-label={`Actions for ${file.name}`} />}
        >
          <Ellipsis aria-hidden="true" />
        </MenuTrigger>
        <MenuContent align="end">
          {kind && (
            <MenuItem
              icon={<Eye />}
              onClick={() => {
                setAction("preview");
              }}
            >
              Preview
            </MenuItem>
          )}
          {!quarantined && (
            <MenuItem
              icon={<Download />}
              onClick={() => {
                setAction("save");
              }}
            >
              Save to this computer…
            </MenuItem>
          )}
          {!quarantined && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<Pencil />}
                onClick={() => {
                  setAction("rename");
                }}
              >
                Rename
              </MenuItem>
              <MenuItem
                icon={<FolderInput />}
                onClick={() => {
                  setAction("move");
                }}
              >
                Move…
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem
            icon={<Trash2 />}
            tone="danger"
            onClick={() => {
              setAction("delete");
            }}
          >
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>

      {kind && <PreviewDialog file={file} open={action === "preview"} onOpenChange={close} />}
      <SaveToComputerDialog
        file={file}
        open={action === "save"}
        onOpenChange={close}
        sharedComputer={sharedComputer}
      />
      <NameDialog
        open={action === "rename"}
        onOpenChange={close}
        title="Rename file"
        description="The name is how you find the file; the type comes from its content."
        label="Name"
        initial={file.name}
        submitLabel="Rename"
        onSubmit={(name) =>
          updateFile(file.id, { name }).then(after(`Renamed to “${shortName(name)}”`))
        }
      />
      <MoveDialog
        open={action === "move"}
        onOpenChange={close}
        itemName={file.name}
        kind="file"
        folders={folders}
        currentParentId={file.folderId}
        onMove={(folderId) =>
          updateFile(file.id, { folderId }).then(after(`Moved “${shortName(file.name)}”`))
        }
      />
      <DeleteDialog
        open={action === "delete"}
        onOpenChange={close}
        title={`Delete “${shortName(file.name)}”?`}
        description="It is removed from Drive straight away. There is no bin to get it back from."
        confirmLabel="Delete file"
        onConfirm={() => deleteFile(file.id).then(after(`Deleted “${shortName(file.name)}”`))}
      />
    </li>
  );
}

function FolderRow({
  folder,
  folders,
  onChanged,
}: {
  folder: DriveFolder;
  folders: readonly DriveFolder[];
  onChanged: (message: string) => void;
}) {
  const [action, setAction] = useState<FolderAction>(null);
  const close = (open: boolean) => {
    if (!open) setAction(null);
  };
  const after = (message: string) => (result: ApiResult<unknown>) => {
    if (result.ok) onChanged(message);
    return result;
  };
  const inside = childFolders(folders, folder.id).length;

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <Folder aria-hidden className="size-4 shrink-0 text-accent-ink" />
      <div className="min-w-0 flex-1">
        <Link
          href={folderHref(folder.id)}
          className="block max-w-full truncate rounded-sm text-callout font-medium text-ink outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {folder.name}
        </Link>
        <p className="text-footnote text-ink-secondary">
          Folder{inside > 0 && ` · ${String(inside)} ${inside === 1 ? "folder" : "folders"} inside`}
        </p>
      </div>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="sm" aria-label={`Actions for ${folder.name}`} />}
        >
          <Ellipsis aria-hidden="true" />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            icon={<Pencil />}
            onClick={() => {
              setAction("rename");
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={<FolderInput />}
            onClick={() => {
              setAction("move");
            }}
          >
            Move…
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 />}
            tone="danger"
            onClick={() => {
              setAction("delete");
            }}
          >
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>
      <NameDialog
        open={action === "rename"}
        onOpenChange={close}
        title="Rename folder"
        description="Choose a name no other folder here has."
        label="Name"
        initial={folder.name}
        submitLabel="Rename"
        onSubmit={(name) => updateFolder(folder.id, { name }).then(after(`Renamed to “${name}”`))}
      />
      <MoveDialog
        open={action === "move"}
        onOpenChange={close}
        itemName={folder.name}
        kind="folder"
        folders={folders}
        currentParentId={folder.parentId}
        movingFolderId={folder.id}
        onMove={(parentId) =>
          updateFolder(folder.id, { parentId }).then(after(`Moved “${folder.name}”`))
        }
      />
      <DeleteDialog
        open={action === "delete"}
        onOpenChange={close}
        title={`Delete “${folder.name}” and everything in it?`}
        description="Every file and folder inside is removed from Drive straight away. There is no bin to get them back from."
        confirmLabel="Delete folder"
        onConfirm={() => deleteFolder(folder.id).then(after(`Deleted “${folder.name}”`))}
      />
    </li>
  );
}

function Breadcrumbs({
  folders,
  currentFolderId,
}: {
  folders: readonly DriveFolder[];
  currentFolderId: string | null;
}) {
  const path = folderPath(folders, currentFolderId);
  const crumbs = [{ id: null as string | null, name: "Drive" }, ...path];
  return (
    <nav aria-label="Folder path">
      <ol className="flex flex-wrap items-center gap-1 text-callout">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.id ?? "root"} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight aria-hidden className="size-3.5 text-ink-tertiary" />}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-ink">
                  {crumb.name}
                </span>
              ) : (
                <Link
                  href={folderHref(crumb.id)}
                  className="truncate rounded-sm text-ink-secondary outline-none hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StorageMeter({ usage }: { usage: DriveUsage }) {
  const percent = Math.min(100, Math.round((usage.usedBytes / usage.limitBytes) * 100));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-footnote text-ink-secondary">
        <span>
          {formatBytes(usage.usedBytes)} of {formatBytes(usage.limitBytes)} used
        </span>
        <span>
          {usage.fileCount} of {usage.fileLimit} files
        </span>
      </div>
      <div
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${formatBytes(usage.usedBytes)} of ${formatBytes(usage.limitBytes)}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-hover"
      >
        <div
          className={
            percent >= 90 ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-accent"
          }
          style={{ width: `${String(Math.max(percent, usage.usedBytes > 0 ? 1 : 0))}%` }}
        />
      </div>
    </div>
  );
}

function SearchForm({ query }: { query: string }) {
  const router = useRouter();
  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    const q = typeof value === "string" ? value.trim() : "";
    router.push(
      q ? (`/app/drive?${new URLSearchParams({ q }).toString()}` as Route) : "/app/drive",
    );
  }
  return (
    <form method="post" role="search" onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1 sm:w-64 sm:flex-none">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-tertiary"
        />
        <Input
          name="q"
          type="search"
          aria-label="Search files"
          placeholder="Search files"
          defaultValue={query}
          key={query}
          maxLength={100}
          autoComplete="off"
          className="pl-9"
        />
      </div>
      {query && (
        <Button variant="ghost" size="sm" render={<Link href="/app/drive" />}>
          <X aria-hidden="true" />
          Clear
        </Button>
      )}
    </form>
  );
}

/** The Drive page: folders, files, uploads, previews and saving. */
export function DriveManager({
  folders,
  files,
  usage,
  currentFolderId,
  query,
  sharedComputer,
  renderedAt,
}: {
  folders: readonly DriveFolder[];
  files: readonly DriveFile[];
  usage: DriveUsage;
  currentFolderId: string | null;
  query: string;
  sharedComputer: boolean;
  renderedAt: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [newFolder, setNewFolder] = useState(false);
  const { uploads, start, dismiss, clearFinished } = useUploads(currentFolderId, usage);
  const searching = query !== "";
  const subfolders = searching ? [] : childFolders(folders, currentFolderId);
  const empty = subfolders.length === 0 && files.length === 0;
  const full = usage.fileCount >= usage.fileLimit || usage.usedBytes >= usage.limitBytes;

  function changed(message: string) {
    toast.add({ type: "success", title: message });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {searching ? (
          <p className="text-callout text-ink-secondary">
            {files.length === 0
              ? `No files match “${query}”`
              : `${String(files.length)} ${files.length === 1 ? "file matches" : "files match"} “${query}”`}
          </p>
        ) : (
          <Breadcrumbs folders={folders} currentFolderId={currentFolderId} />
        )}
        <SearchForm query={query} />
      </div>

      {!searching && (
        <div className="flex flex-wrap items-center gap-2">
          <UploadButton onFiles={start} disabled={full} />
          <Button
            variant="secondary"
            disabled={usage.folderCount >= usage.folderLimit}
            onClick={() => {
              setNewFolder(true);
            }}
          >
            <FolderPlus aria-hidden="true" />
            New folder
          </Button>
          {full && (
            <p className="text-footnote text-ink-secondary">
              Drive is full. Delete some files to upload more.
            </p>
          )}
        </div>
      )}

      <UploadList uploads={uploads} onDismiss={dismiss} onClearFinished={clearFinished} />

      {empty ? (
        <Panel>
          <EmptyState
            icon={searching ? <Search /> : <HardDriveDownload />}
            title={
              searching
                ? "Nothing found"
                : currentFolderId
                  ? "This folder is empty"
                  : "Nothing in Drive yet"
            }
            description={
              searching
                ? "Try a different word. Search looks at file names, not their contents."
                : "Upload a file from this device to carry it to your next computer. Everything is scanned for malware and stored encrypted."
            }
          />
        </Panel>
      ) : (
        <Panel>
          <ul
            aria-label={searching ? "Search results" : "Files and folders"}
            className="divide-y divide-line"
          >
            {subfolders.map((folder) => (
              <FolderRow key={folder.id} folder={folder} folders={folders} onChanged={changed} />
            ))}
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                folders={folders}
                showLocation={searching}
                sharedComputer={sharedComputer}
                renderedAt={renderedAt}
                onChanged={changed}
              />
            ))}
          </ul>
        </Panel>
      )}

      <StorageMeter usage={usage} />

      <NameDialog
        open={newFolder}
        onOpenChange={setNewFolder}
        title="New folder"
        description={`Created in ${describePath(folders, currentFolderId)}.`}
        label="Name"
        submitLabel="Create folder"
        onSubmit={(name) =>
          createFolder({ name, parentId: currentFolderId }).then((result) => {
            if (result.ok) changed(`Created “${name}”`);
            return result;
          })
        }
      />
    </div>
  );
}
