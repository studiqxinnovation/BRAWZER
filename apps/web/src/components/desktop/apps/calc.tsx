"use client";

import { Button } from "@brawzer/ui/components/button";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useAppWindow } from "./app-window";
import { COLUMNS, display, evaluate, fromCsv, ROWS, toCsv } from "./calc-engine";
import { OpenFromDrive } from "./open-from-drive";
import { templateById } from "./templates";
import { useDriveDocument } from "./use-drive-document";

/** Calc: a sheet with formulas, kept in Drive as CSV (formulas as written). */
export default function CalcApp() {
  const window = useAppWindow();
  const template = templateById(window.params.template);
  const [cells, setCells] = useState<Record<string, string>>(() =>
    template?.cells && !window.params.file ? { ...template.cells } : {},
  );
  const [current, setCurrent] = useState("A1");
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const document = useDriveDocument({
    defaultName: template ? `${template.name}.csv` : "Untitled sheet.csv",
    folder: "Sheets",
    type: "text/csv",
    onLoad: (text) => {
      setCells(fromCsv(text));
    },
  });
  const results = useMemo(() => evaluate(cells), [cells]);

  function set(address: string, raw: string) {
    setCells((existing) => {
      if (raw !== "") return { ...existing, [address]: raw };
      return Object.fromEntries(Object.entries(existing).filter(([key]) => key !== address));
    });
    document.changed();
  }

  function move(address: string, columns: number, rows: number) {
    const column = COLUMNS.indexOf(address.charAt(0)) + columns;
    const row = Number(address.slice(1)) + rows;
    const target = `${COLUMNS[Math.min(COLUMNS.length - 1, Math.max(0, column))] ?? "A"}${String(Math.min(ROWS, Math.max(1, row)))}`;
    inputs.current[target]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, address: string) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void document.save(toCsv(cells));
    } else if (event.key === "Enter") {
      event.preventDefault();
      move(address, 0, event.shiftKey ? -1 : 1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(address, 0, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape") {
      setEditing(null);
      event.currentTarget.blur();
    }
  }

  const currentValue = results[current];
  return (
    <div className="ap-body">
      <div className="ap-toolbar">
        <label className="ap-field ap-inline">
          <span className="sr-only">Sheet name</span>
          <input
            className="ap-input ap-name"
            value={document.doc.name}
            onChange={(event) => {
              document.rename(event.target.value);
              document.changed();
            }}
          />
        </label>
        <span className="ap-tb-sep" aria-hidden="true" />
        <span className="ap-formula-ref" aria-live="polite">
          {current}
        </span>
        <label className="ap-grow ap-field ap-inline">
          <span className="sr-only">Formula for {current}</span>
          <input
            className="ap-input ap-grow ap-formula-input"
            value={cells[current] ?? ""}
            placeholder="Type a value or a formula, like =SUM(B3:B5)"
            onChange={(event) => {
              set(current, event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                inputs.current[current]?.focus();
              }
            }}
          />
        </label>
        <Button
          size="sm"
          onClick={() => {
            setPicking(true);
          }}
        >
          Open…
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={document.saving}
          onClick={() => void document.save(toCsv(cells))}
        >
          Save to Drive
        </Button>
      </div>
      <div className="ap-sheet-wrap">
        <table className="ap-sheet" aria-label={document.doc.name}>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Row</span>
              </th>
              {COLUMNS.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, index) => {
              const row = String(index + 1);
              return (
                <tr key={row}>
                  <th scope="row">{row}</th>
                  {COLUMNS.map((column) => {
                    const address = `${column}${row}`;
                    const value = results[address];
                    const shown = editing === address ? (cells[address] ?? "") : display(value);
                    return (
                      <td key={address} data-current={current === address || undefined}>
                        <input
                          ref={(element) => {
                            inputs.current[address] = element;
                          }}
                          aria-label={address}
                          className="ap-cell"
                          data-number={typeof value === "number" || undefined}
                          data-error={
                            (typeof value === "string" && value.startsWith("#")) || undefined
                          }
                          value={shown}
                          spellCheck={false}
                          onFocus={() => {
                            setCurrent(address);
                            setEditing(address);
                          }}
                          onBlur={() => {
                            setEditing((now) => (now === address ? null : now));
                          }}
                          onChange={(event) => {
                            set(address, event.target.value);
                          }}
                          onKeyDown={(event) => {
                            onKeyDown(event, address);
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ap-statusbar">
        <span>
          {current}
          {cells[current] ? ` = ${display(currentValue)}` : " is empty"}
        </span>
        <span>
          SUM · AVERAGE · MIN · MAX · COUNT · ROUND · ABS · + − × ÷ ^ ·{" "}
          {document.doc.fileId
            ? document.dirty
              ? "Not saved yet"
              : "Saved in Drive"
            : "Not in Drive yet"}
        </span>
      </div>
      <OpenFromDrive
        open={picking}
        onOpenChange={setPicking}
        kind="text"
        accept={[".csv"]}
        title="Open a sheet"
        onChoose={(file) => void document.open(file.id, file.name)}
      />
    </div>
  );
}
