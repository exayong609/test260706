import { ClipboardCheck, FileText, Gauge, PackageCheck, RadioTower, ScanLine } from "lucide-react";
import { Dashboard } from "@/components/dashboard";
import { listTicketsFromState } from "@/lib/domain";
import { readState } from "@/lib/store";
import { centsToYuan } from "@/lib/utils";

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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-line">
            <span className="brand-dot" />
            <span>鲸天系统 V3</span>
          </div>
          <h1>运单全流程管理</h1>
          <p>录单同步、扫描品控、异常上报、分级审批、赔付与库存联动。</p>
        </div>
        <div className="topbar-actions">
          <a className="icon-link" href="/docs/assumptions.md" target="_blank" rel="noreferrer">
            <FileText size={17} />
            假设说明
          </a>
          <a className="icon-link" href="/docs/api-contract.md" target="_blank" rel="noreferrer">
            <RadioTower size={17} />
            接口文档
          </a>
        </div>
      </header>

      <section className="metric-strip" aria-label="系统概览">
        <div className="metric">
          <Gauge size={20} />
          <span>开放工单</span>
          <strong>{data.tickets.stats.open}</strong>
        </div>
        <div className="metric">
          <ScanLine size={20} />
          <span>品控工单</span>
          <strong>{data.tickets.stats.quality}</strong>
        </div>
        <div className="metric">
          <PackageCheck size={20} />
          <span>锁定库存</span>
          <strong>{data.inventoryLocked}</strong>
        </div>
        <div className="metric">
          <ClipboardCheck size={20} />
          <span>赔付/追偿</span>
          <strong>{centsToYuan(data.compensationAmount)}</strong>
        </div>
      </section>

      <Dashboard initialData={data} />
    </main>
  );
}
