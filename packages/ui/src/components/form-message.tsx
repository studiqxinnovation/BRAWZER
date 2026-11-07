import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type FormMessageTone = "danger" | "info" | "success";

export interface FormMessageProps {
  tone: FormMessageTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}

const tones: Record<
  FormMessageTone,
  { icon: typeof Info; className: string; iconClassName: string }
> = {
  danger: { icon: CircleAlert, className: "bg-danger-soft", iconClassName: "text-danger" },
  info: { icon: Info, className: "bg-accent-soft", iconClassName: "text-accent-ink" },
  success: { icon: CircleCheck, className: "bg-success-soft", iconClassName: "text-success" },
};

/**
 * A message about the whole form, such as "Email or password is incorrect".
 * Errors are announced immediately (role="alert"); other messages politely.
 */
export function FormMessage({ tone, title, children, className }: FormMessageProps) {
  const { icon: Icon, className: toneClassName, iconClassName } = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-2.5 rounded-lg px-3.5 py-3 text-callout text-ink",
        toneClassName,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconClassName)} />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-pretty">{children}</div>}
      </div>
    </div>
  );
}
