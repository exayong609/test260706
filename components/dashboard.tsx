"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSearch,
  Filter,
  History,
  Loader2,
  LockKeyhole,
  Play,
  RefreshCcw,
  RotateCcw,
  Save,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  UnlockKeyhole,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ApprovalRule,
  ExceptionClass,
  ExceptionType,
  InterfaceSyncLog,
  QualityRule,
  SystemSettings,
  Ticket,
  TicketDetail,
  TicketListQuery,
  User,
  WaybillSnapshot
} from "@/lib/types";
import { exceptionLabels, roleLabels, statusLabels } from "@/lib/types";
import { centsToYuan, id } from "@/lib/utils";

type InitialData = {
  tickets: ReturnType<typeof import("@/lib/domain").listTicketsFromState>;
  users: User[];
  qualityRules: QualityRule[];
  approvalRules: ApprovalRule[];
  settings: SystemSettings;
  logs: InterfaceSyncLog[];
  inventoryLocked: number;
  compensationAmount: number;
  latestWaybills: WaybillSnapshot[];
};

type Toast = { kind: "success" | "error" | "info"; text: string };

const statusOptions = [
  "ALL",
  "PENDING_REVIEW",
  "LEVEL1_REVIEW",
  "LEVEL2_REVIEW",
  "REJECTED_PENDING_RESUBMIT",
  "EXECUTING",
  "COMPLETED",
  "AUTO_CLOSED",
  "FAST_RELEASED"
] as const;

const logisticsTypes: ExceptionType[] = ["LOST", "DAMAGED", "REJECTED", "TIMEOUT", "ADDRESS_ERROR"];

function jsonHeaders() {
  return { "content-type": "application/json" };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data as T;
}

function overdue(ticket: Ticket) {
  return new Date(ticket.dueAt).getTime() < Date.now() && !["COMPLETED", "AUTO_CLOSED", "FAST_RELEASED"].includes(ticket.status);
}

function userName(users: User[], id?: string) {
  return users.find((item) => item.id === id)?.name || id || "未分配";
}

function userByRole(users: User[], role: User["role"]) {
  return users.find((item) => item.role === role && item.active)?.id || users[0]?.id || "";
}

function severityClass(severity: Ticket["severity"]) {
  return severity === "CRITICAL" || severity === "HIGH" ? "danger" : severity === "MEDIUM" ? "warn" : "ok";
}

export function Dashboard({ initialData }: { initialData: InitialData }) {
  const [tickets, setTickets] = useState(initialData.tickets);
  const [users] = useState(initialData.users);
  const [qualityRules, setQualityRules] = useState(initialData.qualityRules);
  const [approvalRules, setApprovalRules] = useState(initialData.approvalRules);
  const [settings, setSettings] = useState(initialData.settings);
  const [logs, setLogs] = useState(initialData.logs);
  const [activeTab, setActiveTab] = useState<"tickets" | "scan" | "report" | "rules" | "monitor">("tickets");
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [filters, setFilters] = useState<TicketListQuery>({ page: 1, pageSize: 12, status: "ALL", exceptionClass: "ALL" });
  const [loading, setLoading] = useState<string>("");
  const [toast, setToast] = useState<Toast | null>(null);

  async function refresh(nextFilters = filters) {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    const data = await api<typeof tickets>(`/api/tickets?${params.toString()}`);
    setTickets(data);
  }

  async function refreshLogs() {
    const data = await api<{ logs: InterfaceSyncLog[] }>("/api/interface-logs");
    setLogs(data.logs);
  }

  async function openDetail(ticketId: string) {
    setLoading(`detail-${ticketId}`);
    try {
      setSelected(await api<TicketDetail>(`/api/tickets/${ticketId}`));
    } catch (error) {
      showError(error);
    } finally {
      setLoading("");
    }
  }

  function showSuccess(text: string) {
    setToast({ kind: "success", text });
    window.setTimeout(() => setToast(null), 3600);
  }

  function showError(error: unknown) {
    setToast({ kind: "error", text: error instanceof Error ? error.message : "操作失败" });
    window.setTimeout(() => setToast(null), 5200);
  }

  const activeUser = useMemo(() => {
    if (selected?.status === "LEVEL2_REVIEW") return userByRole(users, "LEVEL2_APPROVER");
    if (selected?.status === "LEVEL1_REVIEW") return userByRole(users, "LEVEL1_APPROVER");
    return userByRole(users, "OPERATOR");
  }, [selected, users]);

  return (
    <div className="workspace">
      <nav className="tabs" aria-label="功能模块">
        <button className={activeTab === "tickets" ? "active" : ""} onClick={() => setActiveTab("tickets")}>
          <FileSearch size={17} />
          工单追踪
        </button>
        <button className={activeTab === "scan" ? "active" : ""} onClick={() => setActiveTab("scan")}>
          <ScanLine size={17} />
          扫描品控
        </button>
        <button className={activeTab === "report" ? "active" : ""} onClick={() => setActiveTab("report")}>
          <Send size={17} />
          异常上报
        </button>
        <button className={activeTab === "rules" ? "active" : ""} onClick={() => setActiveTab("rules")}>
          <ShieldCheck size={17} />
          规则配置
        </button>
        <button className={activeTab === "monitor" ? "active" : ""} onClick={() => setActiveTab("monitor")}>
          <History size={17} />
          接口监控
        </button>
      </nav>

      {toast ? <div className={`toast ${toast.kind}`}>{toast.text}</div> : null}

      {activeTab === "tickets" ? (
        <TicketsPanel
          tickets={tickets}
          users={users}
          filters={filters}
          loading={loading}
          onFilter={async (next) => {
            const merged = { ...filters, ...next, page: next.page || 1 };
            setFilters(merged);
            setLoading("tickets");
            try {
              await refresh(merged);
            } catch (error) {
              showError(error);
            } finally {
              setLoading("");
            }
          }}
          onOpen={openDetail}
        />
      ) : null}

      {activeTab === "scan" ? (
        <ScanPanel
          users={users}
          waybills={initialData.latestWaybills}
          loading={loading}
          setLoading={setLoading}
          showSuccess={async (message) => {
            showSuccess(message);
            await refresh();
            await refreshLogs();
          }}
          showError={showError}
        />
      ) : null}

      {activeTab === "report" ? (
        <ReportPanel
          users={users}
          waybills={initialData.latestWaybills}
          loading={loading}
          setLoading={setLoading}
          showSuccess={async (message) => {
            showSuccess(message);
            await refresh();
            await refreshLogs();
          }}
          showError={showError}
        />
      ) : null}

      {activeTab === "rules" ? (
        <RulesPanel
          qualityRules={qualityRules}
          approvalRules={approvalRules}
          settings={settings}
          loading={loading}
          setLoading={setLoading}
          onSaved={(data) => {
            setQualityRules(data.qualityRules);
            setApprovalRules(data.approvalRules);
            setSettings(data.settings);
            showSuccess("规则已保存，后续扫描/审批按新配置执行。");
          }}
          showError={showError}
        />
      ) : null}

      {activeTab === "monitor" ? (
        <MonitorPanel
          logs={logs}
          loading={loading}
          onRunJobs={async () => {
            setLoading("jobs");
            try {
              const data = await api<{ events: string[] }>("/api/jobs/run", { method: "POST" });
              showSuccess(data.events.length ? `后台任务完成：${data.events.slice(0, 3).join("、")}` : "后台任务完成，暂无需流转工单。");
              await refresh();
            } catch (error) {
              showError(error);
            } finally {
              setLoading("");
            }
          }}
          onRefresh={async () => {
            setLoading("logs");
            try {
              await refreshLogs();
              showSuccess("接口日志已刷新。");
            } catch (error) {
              showError(error);
            } finally {
              setLoading("");
            }
          }}
        />
      ) : null}

      {selected ? (
        <DetailDrawer
          ticket={selected}
          users={users}
          activeUser={activeUser}
          loading={loading}
          onClose={() => setSelected(null)}
          onChanged={async (message) => {
            showSuccess(message);
            await refresh();
            const latest = await api<TicketDetail>(`/api/tickets/${selected.id}`);
            setSelected(latest);
          }}
          setLoading={setLoading}
          showError={showError}
        />
      ) : null}
    </div>
  );
}

function TicketsPanel({
  tickets,
  users,
  filters,
  loading,
  onFilter,
  onOpen
}: {
  tickets: InitialData["tickets"];
  users: User[];
  filters: TicketListQuery;
  loading: string;
  onFilter: (query: TicketListQuery) => Promise<void>;
  onOpen: (ticketId: string) => void;
}) {
  const pages = Math.max(1, Math.ceil(tickets.total / tickets.pageSize));
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>工单列表与追踪</h2>
          <p>已模拟 {tickets.stats.total} 条工单，覆盖不同状态、类型、超时和审批层级。</p>
        </div>
        <button className="ghost-button" onClick={() => onFilter(filters)} disabled={loading === "tickets"}>
          {loading === "tickets" ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
          刷新
        </button>
      </div>

      <div className="filters">
        <label>
          <Filter size={15} />
          状态
          <select value={filters.status || "ALL"} onChange={(event) => onFilter({ status: event.target.value as TicketListQuery["status"] })}>
            {statusOptions.map((item) => (
              <option key={item} value={item}>
                {item === "ALL" ? "全部状态" : statusLabels[item]}
              </option>
            ))}
          </select>
        </label>
        <label>
          类型
          <select value={filters.exceptionClass || "ALL"} onChange={(event) => onFilter({ exceptionClass: event.target.value as ExceptionClass | "ALL" })}>
            <option value="ALL">全部</option>
            <option value="LOGISTICS">物流异常</option>
            <option value="QUALITY">品控异常</option>
          </select>
        </label>
        <label>
          运单号
          <input value={filters.waybillNo || ""} onChange={(event) => onFilter({ waybillNo: event.target.value })} placeholder="JT2026070001" />
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>工单</th>
              <th>来源</th>
              <th>异常</th>
              <th>金额</th>
              <th>状态</th>
              <th>审批人</th>
              <th>时限</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tickets.items.map((ticket) => (
              <tr key={ticket.id} className={overdue(ticket) ? "row-overdue" : ""}>
                <td>
                  <strong>{ticket.ticketNo}</strong>
                  <small>{ticket.waybillNo}</small>
                </td>
                <td>
                  <span className={`source ${ticket.source === "SCAN" ? "scan" : "manual"}`}>
                    {ticket.source === "SCAN" ? "扫描触发" : "手工上报"}
                  </span>
                </td>
                <td>
                  <span className={`severity ${severityClass(ticket.severity)}`}>{exceptionLabels[ticket.exceptionType]}</span>
                </td>
                <td>{centsToYuan(ticket.amountCents)}</td>
                <td>{statusLabels[ticket.status]}</td>
                <td>{userName(users, ticket.currentAssigneeId)}</td>
                <td>
                  {overdue(ticket) ? <AlertTriangle size={15} className="danger-icon" /> : <Clock size={15} />}
                  {new Date(ticket.dueAt).toLocaleString("zh-CN", { hour12: false })}
                </td>
                <td>
                  <button className="icon-button" title="查看详情" onClick={() => onOpen(ticket.id)}>
                    <FileSearch size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button disabled={tickets.page <= 1} onClick={() => onFilter({ page: tickets.page - 1 })}>
          <ChevronLeft size={16} />
        </button>
        <span>
          第 {tickets.page} / {pages} 页，共 {tickets.total} 条
        </span>
        <button disabled={tickets.page >= pages} onClick={() => onFilter({ page: tickets.page + 1 })}>
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

function ScanPanel({
  users,
  waybills,
  loading,
  setLoading,
  showSuccess,
  showError
}: {
  users: User[];
  waybills: WaybillSnapshot[];
  loading: string;
  setLoading: (value: string) => void;
  showSuccess: (message: string) => Promise<void>;
  showError: (error: unknown) => void;
}) {
  const first = waybills[0];
  const firstLine = first?.skuLines[0];
  const [form, setForm] = useState({
    waybillNo: first?.waybillNo || "JT2026070001",
    sku: firstLine?.sku || "SKU-A100",
    batchNo: firstLine?.batchNo || "",
    scannedQty: firstLine?.qty || 1,
    damageLevel: 2,
    specVarianceMm: 0,
    labelReadable: true,
    operatorId: userByRole(users, "QC_SUPERVISOR"),
    deviceId: "PDA-01",
    description: "外箱破损，扫描系统建议暂扣复核"
  });

  async function submit() {
    setLoading("scan");
    try {
      const data = await api<{ message: string }>("/api/scan", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(form)
      });
      await showSuccess(data.message);
    } catch (error) {
      showError(error);
    } finally {
      setLoading("");
    }
  }

  return (
    <section className="panel split">
      <div>
        <div className="section-head">
          <div>
            <h2>扫描操作与品控检测</h2>
            <p>录入条码/SKU 后实时调用 V2 校验归属，再由可配置品控规则判定是否暂扣。</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            运单号
            <input value={form.waybillNo} onChange={(event) => setForm({ ...form, waybillNo: event.target.value })} />
          </label>
          <label>
            SKU
            <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
          </label>
          <label>
            批次
            <input value={form.batchNo} onChange={(event) => setForm({ ...form, batchNo: event.target.value })} />
          </label>
          <label>
            扫描数量
            <input type="number" value={form.scannedQty} onChange={(event) => setForm({ ...form, scannedQty: Number(event.target.value) })} />
          </label>
          <label>
            破损等级
            <input type="range" min="0" max="4" value={form.damageLevel} onChange={(event) => setForm({ ...form, damageLevel: Number(event.target.value) })} />
            <span className="range-value">{form.damageLevel}</span>
          </label>
          <label>
            规格偏差 mm
            <input type="number" value={form.specVarianceMm} onChange={(event) => setForm({ ...form, specVarianceMm: Number(event.target.value) })} />
          </label>
          <label>
            操作人
            <select value={form.operatorId} onChange={(event) => setForm({ ...form, operatorId: event.target.value })}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {roleLabels[user.role]}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={form.labelReadable} onChange={(event) => setForm({ ...form, labelReadable: event.target.checked })} />
            标签可识别
          </label>
          <label className="wide">
            异常描述
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
        </div>
        <button className="primary-button" onClick={submit} disabled={loading === "scan"}>
          {loading === "scan" ? <Loader2 className="spin" size={17} /> : <ScanLine size={17} />}
          提交扫描
        </button>
      </div>
      <aside className="side-note">
        <LockKeyhole size={20} />
        <h3>品控链路规则</h3>
        <p>命中异常时锁定批次库存，自动创建扫描来源工单；同批次未关闭时重复扫描只追加记录，避免重复工单。</p>
        <p>误判快速放行只能由品控主管执行，后端会校验角色并写入审计记录。</p>
      </aside>
    </section>
  );
}

function ReportPanel({
  users,
  waybills,
  loading,
  setLoading,
  showSuccess,
  showError
}: {
  users: User[];
  waybills: WaybillSnapshot[];
  loading: string;
  setLoading: (value: string) => void;
  showSuccess: (message: string) => Promise<void>;
  showError: (error: unknown) => void;
}) {
  const [form, setForm] = useState({
    waybillNo: waybills[1]?.waybillNo || "JT2026070002",
    exceptionType: "DAMAGED" as ExceptionType,
    amountCents: 68000,
    reporterId: userByRole(users, "OPERATOR"),
    description: "客户反馈签收时外包装破损，需申请理赔并补发"
  });

  async function submit() {
    if (!window.confirm("确认实时调用 V2 校验运单并创建异常工单？")) return;
    setLoading("report");
    try {
      const data = await api<{ ticket: Ticket }>("/api/tickets", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(form)
      });
      await showSuccess(`已创建工单 ${data.ticket.ticketNo}`);
    } catch (error) {
      showError(error);
    } finally {
      setLoading("");
    }
  }

  return (
    <section className="panel split">
      <div>
        <div className="section-head">
          <div>
            <h2>物流异常上报</h2>
            <p>发起上报时强制实时调用 V2 获取运单详情，不允许只凭过期快照创建工单。</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            运单号
            <input value={form.waybillNo} onChange={(event) => setForm({ ...form, waybillNo: event.target.value })} />
          </label>
          <label>
            异常类型
            <select value={form.exceptionType} onChange={(event) => setForm({ ...form, exceptionType: event.target.value as ExceptionType })}>
              {logisticsTypes.map((item) => (
                <option key={item} value={item}>
                  {exceptionLabels[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            涉及金额
            <input type="number" value={form.amountCents / 100} onChange={(event) => setForm({ ...form, amountCents: Math.round(Number(event.target.value) * 100) })} />
          </label>
          <label>
            上报人
            <select value={form.reporterId} onChange={(event) => setForm({ ...form, reporterId: event.target.value })}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {roleLabels[user.role]}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            说明
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
        </div>
        <button className="primary-button" onClick={submit} disabled={loading === "report"}>
          {loading === "report" ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
          创建工单
        </button>
      </div>
      <aside className="side-note">
        <Sparkles size={20} />
        <h3>AI 建议边界</h3>
        <p>文本里出现破损、丢件、赔付等高风险关键词时，系统会展示“AI 建议，需人工确认”。建议只进入详情页辅助决策，不参与自动审批。</p>
      </aside>
    </section>
  );
}

function RulesPanel({
  qualityRules,
  approvalRules,
  settings,
  loading,
  setLoading,
  onSaved,
  showError
}: {
  qualityRules: QualityRule[];
  approvalRules: ApprovalRule[];
  settings: SystemSettings;
  loading: string;
  setLoading: (value: string) => void;
  onSaved: (data: { qualityRules: QualityRule[]; approvalRules: ApprovalRule[]; settings: SystemSettings }) => void;
  showError: (error: unknown) => void;
}) {
  const [qr, setQr] = useState(qualityRules);
  const [ar, setAr] = useState(approvalRules);
  const [localSettings, setLocalSettings] = useState(settings);

  async function save() {
    setLoading("rules");
    try {
      const data = await api<{ qualityRules: QualityRule[]; approvalRules: ApprovalRule[]; settings: SystemSettings }>("/api/rules", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ qualityRules: qr, approvalRules: ar, settings: localSettings })
      });
      onSaved(data);
    } catch (error) {
      showError(error);
    } finally {
      setLoading("");
    }
  }

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>可配置规则引擎</h2>
          <p>金额阈值、审批超时、品控触发条件和暂扣超时都可调整，后续操作立即使用新规则。</p>
        </div>
        <button className="primary-button compact" onClick={save} disabled={loading === "rules"}>
          {loading === "rules" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
          保存
        </button>
      </div>

      <h3 className="subhead">分级审批规则</h3>
      <div className="rule-grid">
        {ar.map((rule, index) => (
          <div className="rule-row" key={rule.id}>
            <input value={rule.name} onChange={(event) => setAr(ar.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} />
            <input type="number" value={rule.minAmountCents / 100} onChange={(event) => setAr(ar.map((item, i) => (i === index ? { ...item, minAmountCents: Number(event.target.value) * 100 } : item)))} />
            <input type="number" placeholder="无上限" value={rule.maxAmountCents ? rule.maxAmountCents / 100 : ""} onChange={(event) => setAr(ar.map((item, i) => (i === index ? { ...item, maxAmountCents: event.target.value ? Number(event.target.value) * 100 : undefined } : item)))} />
            <select value={rule.requiredLevel} onChange={(event) => setAr(ar.map((item, i) => (i === index ? { ...item, requiredLevel: Number(event.target.value) as 1 | 2 } : item)))}>
              <option value={1}>一级</option>
              <option value={2}>二级</option>
            </select>
            <input type="number" value={rule.timeoutHours} onChange={(event) => setAr(ar.map((item, i) => (i === index ? { ...item, timeoutHours: Number(event.target.value) } : item)))} />
          </div>
        ))}
      </div>

      <h3 className="subhead">品控触发规则</h3>
      <div className="rule-grid quality">
        {qr.map((rule, index) => (
          <div className="rule-row" key={rule.id}>
            <input value={rule.name} onChange={(event) => setQr(qr.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} />
            <select value={rule.subtype} onChange={(event) => setQr(qr.map((item, i) => (i === index ? { ...item, subtype: event.target.value as QualityRule["subtype"] } : item)))}>
              <option value="QUANTITY_MISMATCH">数量不符</option>
              <option value="APPEARANCE_DAMAGED">外观破损</option>
              <option value="SPEC_MISMATCH">规格不符</option>
              <option value="LABEL_ERROR">标签错误</option>
              <option value="BATCH_ABNORMAL">批次异常</option>
            </select>
            <select value={rule.field} onChange={(event) => setQr(qr.map((item, i) => (i === index ? { ...item, field: event.target.value as QualityRule["field"] } : item)))}>
              <option value="quantityDeltaPct">数量差异%</option>
              <option value="damageLevel">破损等级</option>
              <option value="specVarianceMm">规格偏差</option>
              <option value="labelReadable">标签可读</option>
              <option value="batchAgeDays">批次库龄</option>
            </select>
            <select value={rule.operator} onChange={(event) => setQr(qr.map((item, i) => (i === index ? { ...item, operator: event.target.value as QualityRule["operator"] } : item)))}>
              <option value=">">&gt;</option>
              <option value=">=">&gt;=</option>
              <option value="=">=</option>
              <option value="!=">!=</option>
            </select>
            <input
              value={String(rule.threshold)}
              onChange={(event) =>
                setQr(
                  qr.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          threshold:
                            item.field === "labelReadable"
                              ? event.target.value === "true"
                              : Number(event.target.value)
                        }
                      : item
                  )
                )
              }
            />
            <select value={rule.targetApprovalLevel} onChange={(event) => setQr(qr.map((item, i) => (i === index ? { ...item, targetApprovalLevel: Number(event.target.value) as 1 | 2 } : item)))}>
              <option value={1}>一级</option>
              <option value={2}>二级</option>
            </select>
          </div>
        ))}
      </div>

      <div className="settings-line">
        <label>
          重提次数上限
          <input type="number" value={localSettings.maxResubmitCount} onChange={(event) => setLocalSettings({ ...localSettings, maxResubmitCount: Number(event.target.value) })} />
        </label>
        <label>
          品控暂扣超时（分钟）
          <input type="number" value={localSettings.qcHoldTimeoutMinutes} onChange={(event) => setLocalSettings({ ...localSettings, qcHoldTimeoutMinutes: Number(event.target.value) })} />
        </label>
      </div>
    </section>
  );
}

function MonitorPanel({
  logs,
  loading,
  onRunJobs,
  onRefresh
}: {
  logs: InterfaceSyncLog[];
  loading: string;
  onRunJobs: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const success = logs.filter((item) => item.success).length;
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>跨系统接口与后台任务</h2>
          <p>每次 V2 调用记录 Request ID、接口、入参摘要、状态码、耗时和错误信息。</p>
        </div>
        <div className="button-row">
          <button className="ghost-button" onClick={onRefresh} disabled={loading === "logs"}>
            {loading === "logs" ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            刷新日志
          </button>
          <button className="primary-button compact" onClick={onRunJobs} disabled={loading === "jobs"}>
            {loading === "jobs" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            运行任务
          </button>
        </div>
      </div>
      <div className="monitor-summary">
        <span>最近日志 {logs.length} 条</span>
        <strong>成功率 {logs.length ? Math.round((success / logs.length) * 100) : 100}%</strong>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Request ID</th>
              <th>接口</th>
              <th>状态</th>
              <th>耗时</th>
              <th>错误</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td><code>{log.requestId}</code></td>
                <td>{log.endpoint}</td>
                <td>{log.success ? "成功" : `失败 ${log.statusCode || ""}`}</td>
                <td>{log.durationMs}ms</td>
                <td>{log.error || "-"}</td>
                <td>{new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailDrawer({
  ticket,
  users,
  activeUser,
  loading,
  onClose,
  onChanged,
  setLoading,
  showError
}: {
  ticket: TicketDetail;
  users: User[];
  activeUser: string;
  loading: string;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  setLoading: (value: string) => void;
  showError: (error: unknown) => void;
}) {
  const [operatorId, setOperatorId] = useState(activeUser);
  const [comment, setComment] = useState("资料完整，同意按规则执行联动");
  const [fastReason, setFastReason] = useState("经复核为扫描误判，外观及标签均符合出库标准");

  async function approve(result: "APPROVE" | "REJECT") {
    if (!window.confirm(result === "APPROVE" ? "确认提交审批通过？通过后将执行赔付/库存联动。" : "确认驳回该工单？")) return;
    setLoading("approve");
    try {
      await api(`/api/tickets/${ticket.id}/approve`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          operatorId,
          result,
          comment,
          expectedVersion: ticket.version,
          idempotencyKey: id("ui")
        })
      });
      await onChanged(result === "APPROVE" ? "审批通过，联动已在同一事务中完成。" : "工单已驳回，等待上报人重提。");
    } catch (error) {
      showError(error);
    } finally {
      setLoading("");
    }
  }

  async function resubmit() {
    setLoading("resubmit");
    try {
      await api(`/api/tickets/${ticket.id}/resubmit`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ reporterId: ticket.reporterId, comment })
      });
      await onChanged("已重新提交，流转回一级审批。");
    } catch (error) {
      showError(error);
    } finally {
      setLoading("");
    }
  }

  async function release() {
    if (!window.confirm("确认以品控主管身份快速放行？该操作会关闭工单并解锁批次。")) return;
    setLoading("fast");
    try {
      await api(`/api/tickets/${ticket.id}/fast-release`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ operatorId, reason: fastReason })
      });
      await onChanged("已快速放行，批次库存已解锁。");
    } catch (error) {
      showError(error);
    } finally {
      setLoading("");
    }
  }

  return (
    <aside className="drawer" aria-label="工单详情">
      <div className="drawer-head">
        <div>
          <span className={`source ${ticket.source === "SCAN" ? "scan" : "manual"}`}>
            {ticket.source === "SCAN" ? "扫描触发" : "手工上报"}
          </span>
          <h2>{ticket.ticketNo}</h2>
          <p>{exceptionLabels[ticket.exceptionType]} · {statusLabels[ticket.status]}</p>
        </div>
        <button className="icon-button" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
      </div>

      <div className="detail-grid">
        <span>运单号</span><strong>{ticket.waybillNo}</strong>
        <span>金额</span><strong>{centsToYuan(ticket.amountCents)}</strong>
        <span>上报人</span><strong>{userName(users, ticket.reporterId)}</strong>
        <span>当前处理人</span><strong>{userName(users, ticket.currentAssigneeId)}</strong>
        <span>运单数据来源</span><strong>{ticket.waybillSource === "V2_REALTIME" ? "实时获取自 V2" : `本地缓存，同步于 ${new Date(ticket.sourceSyncAt).toLocaleString("zh-CN", { hour12: false })}`}</strong>
      </div>

      {ticket.aiSuggestion ? (
        <div className="ai-box">
          <Sparkles size={18} />
          <div>
            <strong>{ticket.aiSuggestion.label}</strong>
            <p>{ticket.aiSuggestion.reason}</p>
            <small>依据：{ticket.aiSuggestion.basedOnTicketNos.join("、") || "暂无历史记录"}</small>
          </div>
        </div>
      ) : null}

      <div className="action-box">
        <label>
          操作人
          <select value={operatorId} onChange={(event) => setOperatorId(event.target.value)}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {roleLabels[user.role]}{user.active ? "" : "（禁用）"}
              </option>
            ))}
          </select>
        </label>
        <label>
          意见
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="button-row">
          {["LEVEL1_REVIEW", "LEVEL2_REVIEW"].includes(ticket.status) ? (
            <>
              <button className="primary-button compact" onClick={() => approve("APPROVE")} disabled={loading === "approve"}>
                {loading === "approve" ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                通过
              </button>
              <button className="danger-button" onClick={() => approve("REJECT")} disabled={loading === "approve"}>
                <X size={16} />
                拒绝
              </button>
            </>
          ) : null}
          {ticket.status === "REJECTED_PENDING_RESUBMIT" ? (
            <button className="primary-button compact" onClick={resubmit} disabled={loading === "resubmit"}>
              <RotateCcw size={16} />
              重新提交
            </button>
          ) : null}
        </div>
        {ticket.source === "SCAN" && !["COMPLETED", "AUTO_CLOSED", "FAST_RELEASED"].includes(ticket.status) ? (
          <div className="fast-release">
            <label>
              快速放行原因
              <textarea value={fastReason} onChange={(event) => setFastReason(event.target.value)} />
            </label>
            <button className="ghost-button" onClick={release} disabled={loading === "fast"}>
              {loading === "fast" ? <Loader2 className="spin" size={16} /> : <UnlockKeyhole size={16} />}
              品控主管快速放行
            </button>
          </div>
        ) : null}
      </div>

      <h3 className="subhead">审计历史</h3>
      <div className="timeline">
        {ticket.approvals.map((item) => (
          <div className="timeline-item" key={item.id}>
            <BadgeCheck size={16} />
            <div>
              <strong>{item.result} · {userName(users, item.operatorId)}</strong>
              <p>{statusLabels[item.beforeStatus]} → {statusLabels[item.afterStatus]}：{item.comment}</p>
              <small>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</small>
            </div>
          </div>
        ))}
        {ticket.approvals.length === 0 ? <p className="empty">暂无审批记录。</p> : null}
      </div>

      <h3 className="subhead">执行联动</h3>
      <div className="compact-list">
        {ticket.compensations.map((item) => (
          <p key={item.id}>{item.direction === "PAY_CUSTOMER" ? "赔付给客户" : "向供应商追偿"} · {centsToYuan(item.amountCents)} · 审批记录 {item.approvalRecordId}</p>
        ))}
        {ticket.inventoryMovements.map((item) => (
          <p key={item.id}>{item.reason} · {item.sku}/{item.batchNo} · 变动 {item.changeQty} · 审批记录 {item.approvalRecordId}</p>
        ))}
        {ticket.compensations.length === 0 && ticket.inventoryMovements.length === 0 ? <p className="empty">暂无下游联动记录。</p> : null}
      </div>
    </aside>
  );
}
