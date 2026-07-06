import type {
  AppState,
  ApprovalRecord,
  ApprovalRule,
  CompensationRecord,
  ExceptionType,
  InventoryItem,
  InventoryMovement,
  QualityRule,
  ScanRecord,
  Ticket,
  User,
  WaybillSnapshot
} from "./types";
import { addHours, id, nowIso } from "./utils";
import { mockV2Waybills } from "./mock-v2";

export const seedUsers: User[] = [
  {
    id: "u-operator-east",
    name: "许录单",
    role: "OPERATOR",
    tenantId: "TENANT-A",
    warehouseId: "WH-EAST",
    active: true
  },
  {
    id: "u-level1-east",
    name: "钱一级",
    role: "LEVEL1_APPROVER",
    tenantId: "TENANT-A",
    warehouseId: "WH-EAST",
    active: true
  },
  {
    id: "u-level2-east",
    name: "孙二级",
    role: "LEVEL2_APPROVER",
    tenantId: "TENANT-A",
    warehouseId: "WH-EAST",
    active: true
  },
  {
    id: "u-qc-east",
    name: "李品控",
    role: "QC_SUPERVISOR",
    tenantId: "TENANT-A",
    warehouseId: "WH-EAST",
    active: true
  },
  {
    id: "u-admin",
    name: "周管理员",
    role: "ADMIN",
    tenantId: "TENANT-A",
    warehouseId: "WH-EAST",
    active: true
  },
  {
    id: "u-disabled-level1",
    name: "离职审批人",
    role: "LEVEL1_APPROVER",
    tenantId: "TENANT-A",
    warehouseId: "WH-EAST",
    active: false
  },
  {
    id: "u-operator-south",
    name: "吴南仓",
    role: "OPERATOR",
    tenantId: "TENANT-B",
    warehouseId: "WH-SOUTH",
    active: true
  }
];

export const defaultApprovalRules: ApprovalRule[] = [
  {
    id: "ar-low",
    name: "小额异常一级审批",
    minAmountCents: 0,
    maxAmountCents: 50000,
    requiredLevel: 1,
    timeoutHours: 8,
    enabled: true
  },
  {
    id: "ar-high",
    name: "大额异常二级审批",
    minAmountCents: 50001,
    requiredLevel: 2,
    timeoutHours: 16,
    enabled: true
  }
];

export const defaultQualityRules: QualityRule[] = [
  {
    id: "qr-qty",
    name: "数量差异超过 3%",
    subtype: "QUANTITY_MISMATCH",
    field: "quantityDeltaPct",
    operator: ">",
    threshold: 3,
    severity: "HIGH",
    autoCreateTicket: true,
    targetApprovalLevel: 2,
    enabled: true,
    updatedAt: nowIso()
  },
  {
    id: "qr-damage",
    name: "外观破损等级达到 2 级",
    subtype: "APPEARANCE_DAMAGED",
    field: "damageLevel",
    operator: ">=",
    threshold: 2,
    severity: "HIGH",
    autoCreateTicket: true,
    targetApprovalLevel: 2,
    enabled: true,
    updatedAt: nowIso()
  },
  {
    id: "qr-spec",
    name: "规格偏差超过 5mm",
    subtype: "SPEC_MISMATCH",
    field: "specVarianceMm",
    operator: ">",
    threshold: 5,
    severity: "MEDIUM",
    autoCreateTicket: true,
    targetApprovalLevel: 1,
    enabled: true,
    updatedAt: nowIso()
  },
  {
    id: "qr-label",
    name: "标签不可识别",
    subtype: "LABEL_ERROR",
    field: "labelReadable",
    operator: "=",
    threshold: false,
    severity: "MEDIUM",
    autoCreateTicket: true,
    targetApprovalLevel: 1,
    enabled: true,
    updatedAt: nowIso()
  }
];

const logisticsTypes: ExceptionType[] = ["LOST", "DAMAGED", "REJECTED", "TIMEOUT", "ADDRESS_ERROR"];
const qualityTypes: ExceptionType[] = [
  "QUANTITY_MISMATCH",
  "APPEARANCE_DAMAGED",
  "SPEC_MISMATCH",
  "LABEL_ERROR",
  "BATCH_ABNORMAL"
];
const statuses: Ticket["status"][] = [
  "PENDING_REVIEW",
  "LEVEL1_REVIEW",
  "LEVEL2_REVIEW",
  "REJECTED_PENDING_RESUBMIT",
  "EXECUTING",
  "COMPLETED",
  "AUTO_CLOSED"
];

function ticketNo(index: number) {
  return `V3-${String(index).padStart(6, "0")}`;
}

function requiredLevel(amountCents: number) {
  return amountCents > 50000 ? 2 : 1;
}

function dueAtFor(status: Ticket["status"], index: number) {
  const base = new Date(Date.UTC(2026, 6, 6, 2, 0, 0));
  if (["PENDING_REVIEW", "LEVEL1_REVIEW", "LEVEL2_REVIEW"].includes(status) && index % 11 === 0) {
    return addHours(base, -2).toISOString();
  }
  return addHours(base, 6 + (index % 18)).toISOString();
}

function buildInventory(waybills: WaybillSnapshot[]): InventoryItem[] {
  const inventory = new Map<string, InventoryItem>();
  for (const waybill of waybills) {
    for (const line of waybill.skuLines) {
      const key = `${line.sku}-${line.batchNo}-${waybill.warehouseId}-${waybill.tenantId}`;
      if (!inventory.has(key)) {
        inventory.set(key, {
          id: id("inv"),
          sku: line.sku,
          batchNo: line.batchNo,
          warehouseId: waybill.warehouseId,
          tenantId: waybill.tenantId,
          availableQty: 80 + (line.qty * 7),
          lockedQty: 0,
          lockStatus: "AVAILABLE",
          updatedAt: nowIso()
        });
      }
    }
  }
  return [...inventory.values()];
}

export function createSeedState(): AppState {
  const waybills = mockV2Waybills().slice(0, 70).map((waybill) => ({
    ...waybill,
    source: "V3_CACHE" as const,
    stale: false
  }));
  const inventory = buildInventory(waybills);
  const tickets: Ticket[] = [];
  const approvals: ApprovalRecord[] = [];
  const compensations: CompensationRecord[] = [];
  const movements: InventoryMovement[] = [];
  const scans: ScanRecord[] = [];

  for (let index = 1; index <= 220; index += 1) {
    const source = index % 4 === 0 ? "SCAN" : "MANUAL";
    const waybill = waybills[index % waybills.length];
    const line = waybill.skuLines[index % waybill.skuLines.length];
    const status = statuses[index % statuses.length];
    const exceptionType = source === "SCAN" ? qualityTypes[index % qualityTypes.length] : logisticsTypes[index % logisticsTypes.length];
    const amountCents = Math.round(waybill.amountCents * (source === "SCAN" ? 0.35 : 0.55));
    const level = source === "SCAN" ? 2 : requiredLevel(amountCents);
    const createdAt = new Date(Date.UTC(2026, 5, 25 + (index % 11), index % 24, index % 60, 0)).toISOString();
    const currentAssigneeId =
      status === "LEVEL1_REVIEW"
        ? index % 17 === 0
          ? "u-disabled-level1"
          : "u-level1-east"
        : status === "LEVEL2_REVIEW"
          ? "u-level2-east"
          : undefined;
    const ticket: Ticket = {
      id: `t-${index}`,
      ticketNo: ticketNo(index),
      source,
      exceptionClass: source === "SCAN" ? "QUALITY" : "LOGISTICS",
      exceptionType,
      severity: index % 13 === 0 ? "CRITICAL" : index % 3 === 0 ? "HIGH" : index % 2 === 0 ? "MEDIUM" : "LOW",
      waybillNo: waybill.waybillNo,
      sku: source === "SCAN" ? line.sku : undefined,
      batchNo: source === "SCAN" ? line.batchNo : undefined,
      amountCents,
      description:
        source === "SCAN"
          ? `扫描发现 ${line.sku} 批次 ${line.batchNo} 疑似 ${exceptionType}`
          : `客户服务上报 ${waybill.waybillNo} 发生 ${exceptionType}`,
      reporterId: source === "SCAN" ? "u-qc-east" : "u-operator-east",
      tenantId: waybill.tenantId,
      warehouseId: waybill.warehouseId,
      status,
      requiredLevel: level,
      currentAssigneeId,
      retryCount: index % 6 === 0 ? 1 : 0,
      version: 1 + (index % 4),
      dueAt: dueAtFor(status, index),
      sourceSyncAt: waybill.syncedAt,
      waybillSource: "V3_CACHE",
      createdAt,
      updatedAt: createdAt,
      completedAt: ["COMPLETED", "AUTO_CLOSED"].includes(status) ? new Date(Date.UTC(2026, 6, 1, index % 24)).toISOString() : undefined,
      executionAction:
        status === "COMPLETED"
          ? source === "SCAN"
            ? "RETURN_SUPPLIER_RECOVERY"
            : exceptionType === "ADDRESS_ERROR"
              ? "RESHIP"
              : "CLAIM_AND_RESHIP"
          : undefined,
      aiSuggestion:
        index % 10 === 0
          ? {
              enabled: true,
              label: "AI 建议，需人工确认：建议二级审批并优先保全证据",
              confidence: 0.78,
              reason: "参考历史高金额破损和丢件工单的处理结果，赔付争议概率较高。",
              basedOnTicketNos: [ticketNo(Math.max(1, index - 2)), ticketNo(Math.max(1, index - 7))]
            }
          : undefined
    };
    tickets.push(ticket);

    if (source === "SCAN") {
      scans.push({
        id: `scan-${index}`,
        scanId: `SCN-${String(index).padStart(6, "0")}`,
        waybillNo: waybill.waybillNo,
        sku: line.sku,
        batchNo: line.batchNo,
        scannedQty: line.qty + (index % 3 === 0 ? 1 : 0),
        expectedQty: line.qty,
        damageLevel: index % 4,
        specVarianceMm: index % 9,
        labelReadable: index % 5 !== 0,
        operatorId: "u-qc-east",
        deviceId: `PDA-${(index % 5) + 1}`,
        qcResult: "ABNORMAL",
        exceptionDescription: ticket.description,
        matchedRuleId: index % 3 === 0 ? "qr-qty" : "qr-damage",
        ruleTrace: "命中可配置品控规则，自动创建工单并锁定批次。",
        batchLockStatus: ["COMPLETED", "AUTO_CLOSED"].includes(status) ? "RELEASED" : "QC_HOLD",
        ticketId: ticket.id,
        createdAt
      });
    }

    if (["COMPLETED", "EXECUTING"].includes(status)) {
      const approvalId = `ap-${index}`;
      approvals.push({
        id: approvalId,
        ticketId: ticket.id,
        operatorId: ticket.requiredLevel === 2 ? "u-level2-east" : "u-level1-east",
        level: ticket.requiredLevel,
        result: "APPROVED",
        comment: "历史样例审批通过，系统自动执行联动。",
        beforeStatus: ticket.requiredLevel === 2 ? "LEVEL2_REVIEW" : "LEVEL1_REVIEW",
        afterStatus: status,
        idempotencyKey: `seed-pass-${index}`,
        createdAt
      });
      const direction = ticket.exceptionClass === "QUALITY" ? "SUPPLIER_RECOVERY" : "PAY_CUSTOMER";
      if (ticket.exceptionType !== "ADDRESS_ERROR") {
        compensations.push({
          id: `cp-${index}`,
          ticketId: ticket.id,
          approvalRecordId: approvalId,
          direction,
          amountCents: Math.max(3000, Math.round(ticket.amountCents * 0.6)),
          status: "PENDING_RECONCILIATION",
          reconciliationMethod: direction === "PAY_CUSTOMER" ? "客户理赔对账单" : "供应商追偿对账单",
          createdAt
        });
      }
      if (ticket.sku && ticket.batchNo) {
        movements.push({
          id: `mv-${index}`,
          sku: ticket.sku,
          batchNo: ticket.batchNo,
          changeQty: ticket.exceptionClass === "QUALITY" ? -1 : 1,
          reason: ticket.exceptionClass === "QUALITY" ? "品控执行联动" : "物流异常补发/退货入库",
          ticketId: ticket.id,
          approvalRecordId: approvalId,
          createdAt
        });
      }
    }
  }

  return {
    users: seedUsers,
    waybillSnapshots: waybills,
    interfaceLogs: [],
    tickets,
    approvals,
    compensations,
    inventory,
    inventoryMovements: movements,
    scans,
    qualityRules: defaultQualityRules,
    approvalRules: defaultApprovalRules,
    settings: {
      maxResubmitCount: 2,
      qcHoldTimeoutMinutes: 90,
      level1FallbackUserId: "u-level1-east",
      level2FallbackUserId: "u-level2-east"
    }
  };
}
