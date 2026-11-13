import { Mark } from "@brawzer/ui/brand";
import type { ReactNode } from "react";
import "./vault.css";

/**
 * The console's door: a restricted-area screen, nothing of the desktop's
 * sky. Graphite, hairlines, uppercase labels, the mark in a sealed square,
 * and the rules of the room stated before the form.
 */
export function Vault({
  title,
  subtitle,
  notice,
  children,
  rules,
  links,
}: {
  title: string;
  subtitle: string;
  notice?: ReactNode;
  children: ReactNode;
  rules?: readonly string[];
  links?: ReactNode;
}) {
  return (
    <div className="vault" data-theme="dark">
      <header className="vault-top">
        <span className="mark">
          <Mark size={18} />
          Brawzer
        </span>
        <span className="vault-mono">Restricted area · staff only</span>
      </header>
      <main id="main-content" className="vault-main">
        <section className="vault-panel" aria-labelledby="vault-title">
          <div className="vault-head">
            <span className="vault-seal" aria-hidden="true">
              <Mark size={22} />
            </span>
            <div>
              <h1 id="vault-title">{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          {notice}
          <div className="vault-body">{children}</div>
          {rules && rules.length > 0 && (
            <ul className="vault-rules" aria-label="Rules of this area">
              {rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          )}
          {links && <div className="vault-links">{links}</div>}
        </section>
      </main>
      <footer className="vault-foot">
        <span>Every action here is written to the audit log</span>
        <span className="vault-mono">Brawzer admin console</span>
      </footer>
    </div>
  );
}
