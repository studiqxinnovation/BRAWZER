import type { INestApplicationContext } from "@nestjs/common";
import { AdminService } from "../admin/admin.service.js";
import { BillingService } from "../billing/billing.service.js";
import { UsageNoticesService } from "../billing/usage-notices.service.js";
import { BrowserService } from "../browser/browser.service.js";
import { RetentionService } from "../maintenance/retention.js";
import { RewrapService } from "../maintenance/rewrap.js";

/** Where a command writes; the CLI passes stdout, tests a buffer. */
export type Write = (line: string) => void;

export const USAGE = `Usage: brawzer <command> [arguments]

Operator commands, run with the API's own configuration (Phase 8, idea 23).

  sessions                         Runtime hosts, the warm pool and every live session
  end-session <session id>         End a session as an administrator would
  find-account <text>              Accounts whose email contains the text
  grant-plan <email> <plan> <why>  Set an account's plan by hand, with a reason ("free" hands back to Stripe)
  rewrap                           Re-wrap every secret under the current encryption key
  usage-notices                    Send due usage emails now
  retention                        Delete expired data now
  help                             This text

In production: docker compose exec api node dist/cli/main.js <command>
Certificates for a runtime host: infra/production/runtime-host/make-certs.sh`;

/** Exit codes: 0 done, 1 failed, 2 not understood. */
export async function runCommand(
  app: INestApplicationContext,
  argv: readonly string[],
  write: Write,
): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      write(USAGE);
      return command === undefined ? 2 : 0;

    case "sessions": {
      const runtime = await app.get(BrowserService).adminRuntime();
      for (const host of runtime.hosts) {
        write(
          `host ${host.name}\t${host.healthy ? "reachable" : "UNREACHABLE"}\t${String(host.live)}/${String(host.capacity)} sessions`,
        );
      }
      write(
        `warm pool\t${runtime.warmPool.size === 0 ? "off" : `${String(runtime.warmPool.waiting)}/${String(runtime.warmPool.size)} waiting`}`,
      );
      if (runtime.sessions.length === 0) write("no live sessions");
      for (const session of runtime.sessions) {
        write(
          [
            session.id,
            session.email,
            session.engine,
            session.host,
            session.status,
            `since ${session.createdAt}`,
            session.throughProxy ? "proxy" : "direct",
          ].join("\t"),
        );
      }
      return 0;
    }

    case "end-session": {
      const [id] = args;
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        write("end-session needs a session id (from `brawzer sessions`).");
        return 2;
      }
      await app.get(BrowserService).endByAdmin(id);
      write(`Session ${id} ended.`);
      return 0;
    }

    case "find-account": {
      const [text] = args;
      if (!text) {
        write("find-account needs part of an email address.");
        return 2;
      }
      const { accounts } = await app.get(AdminService).list({ q: text, limit: 20 });
      if (accounts.length === 0) write("No account matches.");
      for (const account of accounts) {
        write(
          [account.id, account.email, account.planCode, account.source, account.role].join("\t"),
        );
      }
      return 0;
    }

    case "grant-plan": {
      const [email, plan, ...why] = args;
      const reason = why.join(" ").trim();
      if (!email || !plan || reason === "") {
        write("grant-plan needs an email address, a plan code and a reason.");
        return 2;
      }
      const { accounts } = await app.get(AdminService).list({ q: email, limit: 20 });
      const account = accounts.find((candidate) => candidate.email === email.toLowerCase());
      if (!account) {
        write(`No account is ${email}.`);
        return 1;
      }
      await app.get(BillingService).setPlanByAdmin(null, account.id, plan, reason.slice(0, 200), {
        ip: null,
        userAgent: "brawzer cli",
      });
      write(`${account.email} is on ${plan} now; recorded with the reason.`);
      return 0;
    }

    case "rewrap": {
      const result = await app.get(RewrapService).run();
      if (!result) {
        write("Another instance is re-wrapping right now; try again in a minute.");
        return 1;
      }
      const tables = Object.entries(result.rewrapped);
      write(
        tables.length === 0
          ? "Nothing to re-wrap: every secret uses the current key."
          : tables.map(([table, count]) => `${table}: ${String(count)}`).join("\n"),
      );
      if (result.failed > 0)
        write(`${String(result.failed)} could not be re-wrapped (see the log).`);
      return result.failed > 0 ? 1 : 0;
    }

    case "usage-notices": {
      const result = await app.get(UsageNoticesService).run();
      if (!result) {
        write("Another instance is sending them right now.");
        return 1;
      }
      write(`${String(result.sent)} sent, ${String(result.cleared)} cleared.`);
      return 0;
    }

    case "retention": {
      const result = await app.get(RetentionService).run();
      if (!result) {
        write("Another instance is running retention right now.");
        return 1;
      }
      for (const [what, count] of Object.entries(result)) write(`${what}: ${String(count)}`);
      return 0;
    }

    default:
      write(`Unknown command "${command}".\n\n${USAGE}`);
      return 2;
  }
}
