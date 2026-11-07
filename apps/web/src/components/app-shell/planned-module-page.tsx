import { DevState } from "@brawzer/ui/components/dev-state";
import type { PlannedModule } from "@/content/app";
import { PageContainer, PageHeader, Panel } from "./page";

/**
 * A module that isn't built yet: what it will do and what it needs, with no
 * controls that pretend to work.
 */
export function PlannedModulePage({ plan }: { plan: PlannedModule }) {
  return (
    <PageContainer>
      <PageHeader title={plan.title}>
        <p>{plan.lede}</p>
      </PageHeader>
      <div className="flex flex-col gap-6">
        <DevState
          title={`${plan.title} isn’t available yet`}
          milestone={plan.milestone}
          requires={plan.requires}
        >
          Nothing on this page works yet. This is what’s planned and what it depends on.
        </DevState>
        <Panel className="p-6">
          <h2 className="text-title-3 text-ink">What’s planned</h2>
          <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-callout text-ink-secondary">
            {plan.plans.map((plan) => (
              <li key={plan}>{plan}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </PageContainer>
  );
}
