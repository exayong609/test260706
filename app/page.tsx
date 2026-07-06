import { Dashboard } from "@/components/dashboard";
import { listTicketsFromState } from "@/lib/domain";
import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  const data = await readState((state) => ({
    tickets: listTicketsFromState(state, { page: 1, pageSize: 12 }),
    users: state.users,
    qualityRules: state.qualityRules,
    approvalRules: state.approvalRules,
    settings: state.settings,
    logs: state.interfaceLogs.slice(0, 8),
    inventoryLocked: state.inventory.reduce((sum, item) => sum + item.lockedQty, 0),
    compensationAmount: state.compensations.reduce((sum, item) => sum + item.amountCents, 0),
    latestWaybills: state.waybillSnapshots.slice(0, 8)
  }));

  return <Dashboard initialData={data} />;
}
