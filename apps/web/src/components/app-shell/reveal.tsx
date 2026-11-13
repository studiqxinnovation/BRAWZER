"use client";

import { Button } from "@brawzer/ui/components/button";
import { type ReactNode, useId, useState } from "react";
import { Row } from "./page";

/**
 * A row whose button shows more underneath, as the prototype's Security
 * rows do ("Password · Change"): the form opens below the row.
 */
export function Reveal({
  id,
  title,
  sub,
  label,
  openLabel = "Close",
  children,
}: {
  id?: string;
  title: ReactNode;
  sub?: ReactNode;
  label: string;
  openLabel?: string;
  children: ReactNode;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  return (
    <Row
      id={id}
      title={title}
      sub={sub}
      body={
        <div id={panelId} hidden={!open}>
          {children}
        </div>
      }
    >
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        {open ? openLabel : label}
      </Button>
    </Row>
  );
}
