"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import { useAppWindow } from "./app-window";
import { templates } from "./templates";

/** Templates: ready-made documents and sheets, opened as new files in Writer or Calc. */
export default function TemplatesApp() {
  const window = useAppWindow();
  const groups = (["Business", "Study", "Personal"] as const).map((category) => ({
    category,
    items: templates.filter((entry) => entry.category === category),
  }));
  return (
    <div className="ap-body">
      <div className="ap-main">
        {groups.map((group) => (
          <section key={group.category} aria-label={group.category} className="ap-group">
            <h2 className="ap-group-title">{group.category}</h2>
            <ul className="ap-template-grid">
              {group.items.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="ap-template"
                    onClick={() => {
                      window.openApp(entry.app, { template: entry.id });
                    }}
                  >
                    {entry.app === "writer" ? (
                      <FileText aria-hidden="true" />
                    ) : (
                      <FileSpreadsheet aria-hidden="true" />
                    )}
                    <b>{entry.name}</b>
                    <span>{entry.description}</span>
                    <span className="ap-template-app">
                      Opens in {entry.app === "writer" ? "Writer" : "Calc"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
