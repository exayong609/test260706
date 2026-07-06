import type {
  AppState,
  ApprovalRecord,
  ExceptionType,
  InventoryItem,
  QualityRule,
  ScanRecord,
  Ticket,
  TicketDetail,
  TicketListQuery,
  User,
  WaybillSnapshot
} from "./types";
import { exceptionLabels } from "./types";
import { addHours, id, isOpenStatus, normalizeText, nowIso } from "./utils";
import { V2ClientError, fetchWaybillFromV2, validateSkuFromV2 } from "./v2-client";
import { writeState } from "./store";

export class DomainError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}

export function getUser(state: AppState, userId: string) {
  const user = state.users.find((item) => item.id === userId);
  if (!user || !user.active) {
    throw new DomainError("当前用户不存在或已禁用", 403);
  }
  return user;
}

export function canAccess(user: User, tenantId: string, warehouseId: string) {
  if (user.role === "ADMIN") {
    return true;
  }
  return user.tenantId === tenantId && user.warehouseId === warehouseId;
}

function chooseApprover(state: AppState, level: 1 | 2, tenantId: string, warehouseId: string) {
  const role = level === 1 ? "LEVEL1_APPROVER" : "LEVEL2_APPROVER";
  const fallbackId = level === 1 ? state.settings.level1FallbackUserId : state.settings.level2FallbackUserId;
  return (
    state.users.find((item) => item.id === fallbackId && item.active && canAccess(item, tenantId, warehouseId)) ??
    state.users.find((item) => item.role === role && item.active && item.tenantId === tenantId && item.warehouseId === warehouseId) ??
    state.users.find((item) => item.role === "ADMIN" && item.active)
  );
}

function approvalRuleForAmount(state: AppState, amountCents: number) {
  const rule = state.approvalRules
    .filter((item) => item.enabled)
    .find(
      (item) =>
        amountCents >= item.minAmountCents &&
        (item.maxAmountCents === undefined || amountCents <= item.maxAmountCents)
    );
  if (!rule) {
    throw new DomainError("没有可用的分级审批规则，请先配置金额阈值", 422);
  }
  return rule;
}

function timeoutHoursForLevel(state: AppState, level: 1 | 2) {
  const configured = state.approvalRules
    .filter((item) => item.enabled && item.requiredLevel === level)
    .sort((left, right) => left.minAmountCents - right.minAmountCents)[0]?.timeoutHours;
  return configured ?? (level === 1 ? 8 : 16);
}

function approvalDueAt(state: AppState, level: 1 | 2) {
  return addHours(new Date(), timeoutHoursForLevel(state, level)).toISOString();
}

function pushLogs(state: AppState, logs: AppState["interfaceLogs"]) {
  state.interfaceLogs.unshift(...logs);
  state.interfaceLogs = state.interfaceLogs.slice(0, 500);
}

function upsertSnapshot(state: AppState, waybill: WaybillSnapshot) {
  const snapshot: WaybillSnapshot = {
    ...waybill,
    source: waybill.source || "V2_REALTIME",
    syncedAt: nowIso(),
    stale: false
  };
  const index = state.waybillSnapshots.findIndex((item) => item.waybillNo === waybill.waybillNo);
  if (index >= 0) {
    state.waybillSnapshots[index] = snapshot;
  } else {
    state.waybillSnapshots.push(snapshot);
  }
  return snapshot;
}

function fallbackSnapshot(state: AppState, waybillNo: string) {
  const cached = state.waybillSnapshots.find((item) => item.waybillNo === waybillNo);
  if (!cached) {
    throw new DomainError("V2 不可用，且本地没有该运单快照，不能发起关键业务动作", 503);
  }
  return {
    ...cached,
    source: "V3_CACHE" as const,
    stale: true
  };
}

export async function realtimeWaybill(state: AppState, waybillNo: string, allowCacheFallback: boolean) {
  try {
    const { data, logs } = await fetchWaybillFromV2(waybillNo);
    pushLogs(state, logs);
    return upsertSnapshot(state, data);
  } catch (error) {
    if (error instanceof V2ClientError) {
      pushLogs(state, error.logs);
      if (allowCacheFallback) {
        return fallbackSnapshot(state, waybillNo);
      }
      throw new DomainError(error.statusCode === 404 ? "V2 校验失败：运单不存在" : `V2 实时校验失败：${error.message}`, error.statusCode === 404 ? 404 : 503);
    }
    throw error;
  }
}

function ensureNoDuplicateManualTicket(state: AppState, waybillNo: string, exceptionType: ExceptionType) {
  const existing = state.tickets.find(
    (item) =>
      item.source === "MANUAL" &&
      item.waybillNo === waybillNo &&
      item.exceptionType === exceptionType &&
      isOpenStatus(item.status)
  );
  if (existing) {
    throw new DomainError(`同一运单已有未关闭的同类型工单：${existing.ticketNo}（${existing.status}）`, 409);
  }
}

function ticketNumber(state: AppState) {
  const next = state.tickets.length + 1;
  return `V3-${String(next).padStart(6, "0")}`;
}

function aiSuggestionFor(description: string, state: AppState) {
  const text = description.toLowerCase();
  if (!/(丢|破|坏|超时|拒收|地址|赔|损)/.test(text)) {
    return undefined;
  }
  const references = state.tickets
    .filter((item) => ["COMPLETED", "EXECUTING"].includes(item.status))
    .slice(0, 3)
    .map((item) => item.ticketNo);
  return {
    enabled: true,
    label: "AI 建议，需人工确认：建议按高风险异常保留证据并核对赔付金额",
    confidence: 0.72,
    reason: "基于描述中的风险关键词和历史已完成工单结果，仅作为审批辅助，不自动执行。",
    basedOnTicketNos: references
  };
}

export async function createManualTicket(input: {
  waybillNo: string;
  exceptionType: ExceptionType;
  amountCents: number;
  description: string;
  reporterId: string;
}) {
  return writeState(async (state) => {
    const reporter = getUser(state, input.reporterId);
    if (!["OPERATOR", "ADMIN"].includes(reporter.role)) {
      throw new DomainError("只有操作员或管理员可以手工上报物流异常", 403);
    }
    const waybill = await realtimeWaybill(state, input.waybillNo, false);
    if (!canAccess(reporter, waybill.tenantId, waybill.warehouseId)) {
      throw new DomainError("不能跨租户或跨仓库上报他人运单异常", 403);
    }
    ensureNoDuplicateManualTicket(state, input.waybillNo, input.exceptionType);
    const rule = approvalRuleForAmount(state, input.amountCents);
    const assignee = chooseApprover(state, 1, waybill.tenantId, waybill.warehouseId);
    const createdAt = nowIso();
    const ticket: Ticket = {
      id: id("ticket"),
      ticketNo: ticketNumber(state),
      source: "MANUAL",
      exceptionClass: "LOGISTICS",
      exceptionType: input.exceptionType,
      severity: input.amountCents > 150000 ? "HIGH" : input.amountCents > 50000 ? "MEDIUM" : "LOW",
      waybillNo: waybill.waybillNo,
      amountCents: input.amountCents,
      description: normalizeText(input.description),
      reporterId: reporter.id,
      tenantId: waybill.tenantId,
      warehouseId: waybill.warehouseId,
      status: "LEVEL1_REVIEW",
      requiredLevel: rule.requiredLevel,
      currentAssigneeId: assignee?.id,
      retryCount: 0,
      version: 1,
      dueAt: approvalDueAt(state, 1),
      sourceSyncAt: waybill.syncedAt,
      waybillSource: waybill.source,
      createdAt,
      updatedAt: createdAt,
      aiSuggestion: aiSuggestionFor(input.description, state)
    };
    state.tickets.unshift(ticket);
    return { ticket };
  });
}

function compare(left: number | boolean, operator: QualityRule["operator"], right: number | boolean) {
  if (operator === "=") return left === right;
  if (operator === "!=") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (operator === ">") return left > right;
  if (operator === ">=") return left >= right;
  return false;
}

function evaluateQualityRules(rules: QualityRule[], metrics: Record<QualityRule["field"], number | boolean>) {
  for (const rule of rules.filter((item) => item.enabled)) {
    const actual = metrics[rule.field];
    if (compare(actual, rule.operator, rule.threshold)) {
      return {
        result: "ABNORMAL" as const,
        rule,
        trace: `命中规则 ${rule.name}：${rule.field} 实际值 ${String(actual)} ${rule.operator} ${String(rule.threshold)}`
      };
    }
  }
  return {
    result: "PASS" as const,
    rule: undefined,
    trace: "未命中任何启用的品控异常规则，判定通过。"
  };
}

function inventoryFor(state: AppState, waybill: WaybillSnapshot, sku: string, batchNo: string) {
  let item = state.inventory.find(
    (entry) =>
      entry.sku === sku &&
      entry.batchNo === batchNo &&
      entry.tenantId === waybill.tenantId &&
      entry.warehouseId === waybill.warehouseId
  );
  if (!item) {
    item = {
      id: id("inv"),
      sku,
      batchNo,
      warehouseId: waybill.warehouseId,
      tenantId: waybill.tenantId,
      availableQty: 0,
      lockedQty: 0,
      lockStatus: "AVAILABLE",
      updatedAt: nowIso()
    };
    state.inventory.push(item);
  }
  return item;
}

function findOpenQcTicket(state: AppState, waybillNo: string, sku: string, batchNo: string) {
  return state.tickets.find(
    (item) =>
      item.source === "SCAN" &&
      item.waybillNo === waybillNo &&
      item.sku === sku &&
      item.batchNo === batchNo &&
      isOpenStatus(item.status)
  );
}

function findOpenQcTicketByBatch(state: AppState, sku: string, batchNo: string, tenantId: string, warehouseId: string) {
  return state.tickets.find(
    (item) =>
      item.source === "SCAN" &&
      item.sku === sku &&
      item.batchNo === batchNo &&
      item.tenantId === tenantId &&
      item.warehouseId === warehouseId &&
      isOpenStatus(item.status)
  );
}

export async function scanWaybill(input: {
  waybillNo: string;
  sku: string;
  batchNo?: string;
  scannedQty: number;
  damageLevel: number;
  specVarianceMm: number;
  labelReadable: boolean;
  operatorId: string;
  deviceId: string;
  description: string;
}) {
  return writeState(async (state) => {
    const operator = getUser(state, input.operatorId);
    if (!["OPERATOR", "QC_SUPERVISOR", "ADMIN"].includes(operator.role)) {
      throw new DomainError("当前角色不能执行扫描录入", 403);
    }
    let waybill: WaybillSnapshot;
    let expectedLine: WaybillSnapshot["skuLines"][number];
    try {
      const { data, logs } = await validateSkuFromV2(input.waybillNo, input.sku);
      pushLogs(state, logs);
      waybill = upsertSnapshot(state, data.waybill);
      expectedLine = data.line;
    } catch (error) {
      if (error instanceof V2ClientError) {
        pushLogs(state, error.logs);
        throw new DomainError(error.statusCode === 404 ? "V2 校验失败：SKU 不属于该运单或运单不存在" : `V2 SKU 归属校验失败：${error.message}`, error.statusCode === 404 ? 404 : 503);
      }
      throw error;
    }
    if (!canAccess(operator, waybill.tenantId, waybill.warehouseId)) {
      throw new DomainError("不能跨租户或跨仓库扫描运单 SKU", 403);
    }
    const batchNo = input.batchNo || expectedLine.batchNo;
    const quantityDeltaPct = expectedLine.qty === 0 ? 0 : Math.abs(input.scannedQty - expectedLine.qty) / expectedLine.qty * 100;
    const metrics = {
      quantityDeltaPct,
      damageLevel: input.damageLevel,
      specVarianceMm: input.specVarianceMm,
      labelReadable: input.labelReadable,
      batchAgeDays: batchNo.includes("202606") ? 35 : 5
    };
    const evaluation = evaluateQualityRules(state.qualityRules, metrics);
    const existing = findOpenQcTicket(state, waybill.waybillNo, input.sku, batchNo);
    const heldByAnotherTicket = findOpenQcTicketByBatch(state, input.sku, batchNo, waybill.tenantId, waybill.warehouseId);
    if (heldByAnotherTicket && heldByAnotherTicket.waybillNo !== waybill.waybillNo) {
      throw new DomainError(`SKU ${input.sku} 批次 ${batchNo} 已被 ${heldByAnotherTicket.ticketNo} 品控暂扣，其他运单不可引用。`, 409);
    }
    const createdAt = nowIso();
    let ticket = existing;
    let idempotentMessage: string | undefined;
    let inventory = inventoryFor(state, waybill, input.sku, batchNo);

    if (evaluation.result === "ABNORMAL" && evaluation.rule?.autoCreateTicket === false) {
      idempotentMessage = `命中规则 ${evaluation.rule.name}，但规则未启用自动建单；已记录异常扫描，等待人工复核。`;
    } else if (evaluation.result === "ABNORMAL") {
      if (existing) {
        idempotentMessage = `该批次已存在未关闭品控工单：${existing.ticketNo}，本次只追加扫描记录。`;
      } else {
        const rule = evaluation.rule;
        const assignee = chooseApprover(state, rule?.targetApprovalLevel === 1 ? 1 : 2, waybill.tenantId, waybill.warehouseId);
        ticket = {
          id: id("ticket"),
          ticketNo: ticketNumber(state),
          source: "SCAN",
          exceptionClass: "QUALITY",
          exceptionType: rule?.subtype ?? "BATCH_ABNORMAL",
          severity: rule?.severity ?? "HIGH",
          waybillNo: waybill.waybillNo,
          sku: input.sku,
          batchNo,
          amountCents: Math.round(waybill.amountCents * 0.35),
          description: normalizeText(input.description) || `扫描发现 ${input.sku} 批次 ${batchNo} 异常`,
          reporterId: operator.id,
          tenantId: waybill.tenantId,
          warehouseId: waybill.warehouseId,
          status: rule?.targetApprovalLevel === 1 ? "LEVEL1_REVIEW" : "LEVEL2_REVIEW",
          requiredLevel: rule?.targetApprovalLevel ?? 2,
          currentAssigneeId: assignee?.id,
          retryCount: 0,
          version: 1,
          dueAt: approvalDueAt(state, rule?.targetApprovalLevel === 1 ? 1 : 2),
          sourceSyncAt: waybill.syncedAt,
          waybillSource: waybill.source,
          createdAt,
          updatedAt: createdAt,
          aiSuggestion: aiSuggestionFor(input.description, state)
        };
        state.tickets.unshift(ticket);
        inventory.availableQty = Math.max(0, inventory.availableQty - expectedLine.qty);
        inventory.lockedQty += expectedLine.qty;
        inventory.lockTicketId = ticket.id;
        inventory.lockStatus = "QC_HOLD";
        inventory.updatedAt = createdAt;
      }
    } else if (existing) {
      idempotentMessage = `该批次仍处于 ${existing.ticketNo} 品控暂扣中，本次只追加复扫记录，不自动解锁。`;
    }

    const scan: ScanRecord = {
      id: id("scan"),
      scanId: id("SCN").toUpperCase(),
      waybillNo: waybill.waybillNo,
      sku: input.sku,
      batchNo,
      scannedQty: input.scannedQty,
      expectedQty: expectedLine.qty,
      damageLevel: input.damageLevel,
      specVarianceMm: input.specVarianceMm,
      labelReadable: input.labelReadable,
      operatorId: operator.id,
      deviceId: normalizeText(input.deviceId) || "PDA-MANUAL",
      qcResult: evaluation.result,
      exceptionDescription: normalizeText(input.description),
      matchedRuleId: evaluation.rule?.id,
      ruleTrace: evaluation.trace,
      batchLockStatus: ticket ? "QC_HOLD" : "AVAILABLE",
      ticketId: ticket?.id,
      createdAt
    };
    state.scans.push(scan);
    return { scan, ticket, message: idempotentMessage ?? (evaluation.result === "PASS" ? "品控通过，批次可出库。" : "命中品控规则，已锁定批次并创建工单。") };
  });
}

function ensureApprovalPermission(user: User, ticket: Ticket, expectedLevel: 1 | 2) {
  if (!canAccess(user, ticket.tenantId, ticket.warehouseId)) {
    throw new DomainError("无权处理其他租户或仓库的工单", 403);
  }
  if (ticket.reporterId === user.id) {
    throw new DomainError("上报人不能审批自己提交的工单", 403);
  }
  if (expectedLevel === 1 && !["LEVEL1_APPROVER", "ADMIN"].includes(user.role)) {
    throw new DomainError("当前角色不能进行一级审批", 403);
  }
  if (expectedLevel === 2 && !["LEVEL2_APPROVER", "ADMIN"].includes(user.role)) {
    throw new DomainError("当前角色不能进行二级审批", 403);
  }
  if (ticket.currentAssigneeId && ticket.currentAssigneeId !== user.id && user.role !== "ADMIN") {
    throw new DomainError("该工单当前分配给其他审批人", 403);
  }
}

function logisticsAction(type: ExceptionType) {
  if (type === "ADDRESS_ERROR") return "RESHIP";
  if (type === "REJECTED") return "RETURN_INBOUND";
  if (type === "TIMEOUT") return "TRACK_AND_OPTIONAL_CLAIM";
  return "CLAIM_AND_RESHIP";
}

function qualityAction(type: ExceptionType) {
  if (type === "LABEL_ERROR") return "RELEASE_AFTER_RELABEL";
  if (type === "SPEC_MISMATCH") return "DOWNGRADE_RECOVERY";
  if (type === "QUANTITY_MISMATCH") return "REPURCHASE_RECOVERY";
  return "RETURN_SUPPLIER_RECOVERY";
}

function executeLinkedActions(state: AppState, ticket: Ticket, approval: ApprovalRecord) {
  const createdAt = nowIso();
  const action = ticket.exceptionClass === "QUALITY" ? qualityAction(ticket.exceptionType) : logisticsAction(ticket.exceptionType);
  ticket.executionAction = action;

  const needsCompensation =
    ticket.exceptionClass === "QUALITY"
      ? action !== "RELEASE_AFTER_RELABEL"
      : ["CLAIM_AND_RESHIP", "TRACK_AND_OPTIONAL_CLAIM"].includes(action);
  if (needsCompensation) {
    state.compensations.push({
      id: id("comp"),
      ticketId: ticket.id,
      approvalRecordId: approval.id,
      direction: ticket.exceptionClass === "QUALITY" ? "SUPPLIER_RECOVERY" : "PAY_CUSTOMER",
      amountCents: ticket.exceptionClass === "QUALITY" ? Math.round(ticket.amountCents * 0.8) : Math.round(ticket.amountCents * 0.6),
      status: "PENDING_RECONCILIATION",
      reconciliationMethod: ticket.exceptionClass === "QUALITY" ? "供应商追偿对账单" : "客户理赔对账单",
      createdAt
    });
  }

  if (ticket.sku && ticket.batchNo) {
    const inventory = state.inventory.find(
      (item) =>
        item.sku === ticket.sku &&
        item.batchNo === ticket.batchNo &&
        item.tenantId === ticket.tenantId &&
        item.warehouseId === ticket.warehouseId
    );
    if (inventory) {
      if (ticket.exceptionClass === "QUALITY") {
        const scanQty = Math.max(1, ...state.scans.filter((item) => item.ticketId === ticket.id).map((item) => item.expectedQty));
        const affectedQty = inventory.lockTicketId === ticket.id ? inventory.lockedQty : scanQty;
        inventory.lockedQty = Math.max(0, inventory.lockedQty - affectedQty);
        if (action === "RELEASE_AFTER_RELABEL") {
          inventory.availableQty += affectedQty;
          inventory.lockStatus = "RELEASED";
        } else if (action === "RETURN_SUPPLIER_RECOVERY") {
          inventory.lockStatus = "RETURNED";
        } else {
          inventory.lockStatus = action === "REPURCHASE_RECOVERY" ? "SCRAPPED" : "RELEASED";
        }
        inventory.lockTicketId = undefined;
        inventory.updatedAt = createdAt;
      } else if (action === "RETURN_INBOUND") {
        inventory.availableQty += 1;
        inventory.updatedAt = createdAt;
      } else if (action === "CLAIM_AND_RESHIP") {
        inventory.availableQty = Math.max(0, inventory.availableQty - 1);
        inventory.updatedAt = createdAt;
      }
      state.inventoryMovements.push({
        id: id("move"),
        sku: ticket.sku,
        batchNo: ticket.batchNo,
        changeQty:
          ticket.exceptionClass === "QUALITY"
            ? action === "RELEASE_AFTER_RELABEL"
              ? Math.max(1, ...state.scans.filter((item) => item.ticketId === ticket.id).map((item) => item.expectedQty))
              : -Math.max(1, ...state.scans.filter((item) => item.ticketId === ticket.id).map((item) => item.expectedQty))
            : action === "RETURN_INBOUND"
              ? 1
              : -1,
        reason: action,
        ticketId: ticket.id,
        approvalRecordId: approval.id,
        createdAt
      });
    }
  }

  for (const scan of state.scans.filter((item) => item.ticketId === ticket.id)) {
    scan.batchLockStatus =
      ticket.exceptionClass === "QUALITY" && action === "RETURN_SUPPLIER_RECOVERY"
        ? "RETURNED"
        : ticket.exceptionClass === "QUALITY" && action === "REPURCHASE_RECOVERY"
          ? "SCRAPPED"
          : "RELEASED";
  }
}

export async function approveTicket(input: {
  ticketId: string;
  operatorId: string;
  result: "APPROVE" | "REJECT";
  comment: string;
  expectedVersion: number;
  idempotencyKey: string;
}) {
  return writeState((state) => {
    const user = getUser(state, input.operatorId);
    const ticket = state.tickets.find((item) => item.id === input.ticketId);
    if (!ticket) throw new DomainError("工单不存在", 404);
    const existingApproval = state.approvals.find(
      (item) => item.ticketId === input.ticketId && item.idempotencyKey === input.idempotencyKey
    );
    if (existingApproval) {
      return { ticket, approval: existingApproval, idempotent: true };
    }
    if (ticket.version !== input.expectedVersion) {
      throw new DomainError("该工单已被处理，请刷新后再操作", 409);
    }
    const expectedLevel = ticket.status === "LEVEL1_REVIEW" ? 1 : ticket.status === "LEVEL2_REVIEW" ? 2 : undefined;
    if (!expectedLevel) {
      throw new DomainError("当前状态不能审批", 409);
    }
    ensureApprovalPermission(user, ticket, expectedLevel);

    const before = ticket.status;
    let after: Ticket["status"];
    if (input.result === "REJECT") {
      if (ticket.retryCount >= state.settings.maxResubmitCount) {
        after = ticket.requiredLevel === 2 ? "AUTO_CLOSED" : "LEVEL2_REVIEW";
        ticket.currentAssigneeId = after === "LEVEL2_REVIEW" ? chooseApprover(state, 2, ticket.tenantId, ticket.warehouseId)?.id : undefined;
      } else {
        after = "REJECTED_PENDING_RESUBMIT";
        ticket.currentAssigneeId = undefined;
      }
    } else if (expectedLevel === 1 && ticket.requiredLevel === 2) {
      after = "LEVEL2_REVIEW";
      ticket.currentAssigneeId = chooseApprover(state, 2, ticket.tenantId, ticket.warehouseId)?.id;
      ticket.dueAt = approvalDueAt(state, 2);
    } else {
      after = "COMPLETED";
      ticket.currentAssigneeId = undefined;
      ticket.completedAt = nowIso();
    }
    const approval: ApprovalRecord = {
      id: id("apv"),
      ticketId: ticket.id,
      operatorId: user.id,
      level: expectedLevel,
      result: input.result === "APPROVE" ? "APPROVED" : "REJECTED",
      comment: normalizeText(input.comment),
      beforeStatus: before,
      afterStatus: after,
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso()
    };
    ticket.status = after;
    ticket.version += 1;
    ticket.updatedAt = approval.createdAt;
    state.approvals.push(approval);
    if (after === "COMPLETED") {
      executeLinkedActions(state, ticket, approval);
    }
    return { ticket, approval, idempotent: false };
  });
}

export async function resubmitTicket(input: { ticketId: string; reporterId: string; comment: string }) {
  return writeState((state) => {
    const reporter = getUser(state, input.reporterId);
    const ticket = state.tickets.find((item) => item.id === input.ticketId);
    if (!ticket) throw new DomainError("工单不存在", 404);
    if (ticket.reporterId !== reporter.id && reporter.role !== "ADMIN") {
      throw new DomainError("只有原上报人可以重新提交该工单", 403);
    }
    if (ticket.status !== "REJECTED_PENDING_RESUBMIT") {
      throw new DomainError("当前状态不能重新提交", 409);
    }
    if (ticket.retryCount >= state.settings.maxResubmitCount) {
      throw new DomainError("已达到重新提交次数上限", 409);
    }
    const before = ticket.status;
    ticket.retryCount += 1;
    ticket.status = "LEVEL1_REVIEW";
    ticket.currentAssigneeId = chooseApprover(state, 1, ticket.tenantId, ticket.warehouseId)?.id;
    ticket.version += 1;
    ticket.updatedAt = nowIso();
    ticket.dueAt = approvalDueAt(state, 1);
    const approval: ApprovalRecord = {
      id: id("apv"),
      ticketId: ticket.id,
      operatorId: reporter.id,
      level: 0,
      result: "RESUBMITTED",
      comment: normalizeText(input.comment),
      beforeStatus: before,
      afterStatus: ticket.status,
      idempotencyKey: id("resubmit"),
      createdAt: nowIso()
    };
    state.approvals.push(approval);
    return { ticket, approval };
  });
}

export async function fastRelease(input: { ticketId: string; operatorId: string; reason: string }) {
  return writeState((state) => {
    const user = getUser(state, input.operatorId);
    const ticket = state.tickets.find((item) => item.id === input.ticketId);
    if (!ticket) throw new DomainError("工单不存在", 404);
    if (!["QC_SUPERVISOR", "ADMIN"].includes(user.role)) {
      throw new DomainError("只有品控主管可以执行误判快速放行", 403);
    }
    if (ticket.source !== "SCAN" || ticket.exceptionClass !== "QUALITY") {
      throw new DomainError("快速放行仅适用于扫描触发的品控工单", 409);
    }
    if (!isOpenStatus(ticket.status)) {
      throw new DomainError("工单已关闭，不能快速放行", 409);
    }
    if (!normalizeText(input.reason)) {
      throw new DomainError("快速放行必须填写复核原因", 422);
    }
    const before = ticket.status;
    ticket.status = "FAST_RELEASED";
    ticket.currentAssigneeId = undefined;
    ticket.completedAt = nowIso();
    ticket.updatedAt = ticket.completedAt;
    ticket.version += 1;
    const approval: ApprovalRecord = {
      id: id("apv"),
      ticketId: ticket.id,
      operatorId: user.id,
      level: 0,
      result: "FAST_RELEASED",
      comment: `品控主管误判复核：${normalizeText(input.reason)}`,
      beforeStatus: before,
      afterStatus: ticket.status,
      idempotencyKey: id("fast"),
      createdAt: nowIso()
    };
    state.approvals.push(approval);
    const inv = state.inventory.find((item) => item.lockTicketId === ticket.id);
    if (inv) {
      inv.availableQty += inv.lockedQty;
      inv.lockedQty = 0;
      inv.lockTicketId = undefined;
      inv.lockStatus = "RELEASED";
      inv.updatedAt = nowIso();
    }
    for (const scan of state.scans.filter((item) => item.ticketId === ticket.id)) {
      scan.batchLockStatus = "RELEASED";
    }
    return { ticket, approval };
  });
}

export async function runBackgroundJobs() {
  return writeState((state) => {
    const now = Date.now();
    const events: string[] = [];
    for (const ticket of state.tickets) {
      if (ticket.currentAssigneeId) {
        const assignee = state.users.find((item) => item.id === ticket.currentAssigneeId);
        if (assignee && !assignee.active && ["LEVEL1_REVIEW", "LEVEL2_REVIEW"].includes(ticket.status)) {
          const target = chooseApprover(state, ticket.status === "LEVEL1_REVIEW" ? 1 : 2, ticket.tenantId, ticket.warehouseId);
          const before = ticket.status;
          ticket.currentAssigneeId = target?.id;
          ticket.version += 1;
          ticket.updatedAt = nowIso();
          state.approvals.push({
            id: id("apv"),
            ticketId: ticket.id,
            operatorId: "system",
            level: ticket.status === "LEVEL1_REVIEW" ? 1 : 2,
            result: "TRANSFERRED",
            comment: `原审批人已禁用，自动转交给 ${target?.name ?? "管理员"}`,
            beforeStatus: before,
            afterStatus: ticket.status,
            idempotencyKey: `transfer-${ticket.id}-${ticket.version}`,
            createdAt: nowIso()
          });
          events.push(`${ticket.ticketNo} 已转交`);
        }
      }
      if (["PENDING_REVIEW", "LEVEL1_REVIEW", "LEVEL2_REVIEW"].includes(ticket.status) && new Date(ticket.dueAt).getTime() < now) {
        const before = ticket.status;
        if (ticket.status === "LEVEL2_REVIEW") {
          ticket.status = "AUTO_CLOSED";
          ticket.currentAssigneeId = undefined;
        } else {
          ticket.status = "LEVEL2_REVIEW";
          ticket.currentAssigneeId = chooseApprover(state, 2, ticket.tenantId, ticket.warehouseId)?.id;
          ticket.dueAt = approvalDueAt(state, 2);
        }
        ticket.version += 1;
        ticket.updatedAt = nowIso();
        state.approvals.push({
          id: id("apv"),
          ticketId: ticket.id,
          operatorId: "system",
          level: before === "LEVEL2_REVIEW" ? 2 : 1,
          result: before === "LEVEL2_REVIEW" ? "AUTO_REJECTED" : "AUTO_ESCALATED",
          comment: before === "LEVEL2_REVIEW" ? "二级审批超时，按兜底策略自动关闭。" : "审批超时，自动升级二级审批。",
          beforeStatus: before,
          afterStatus: ticket.status,
          idempotencyKey: `timeout-${ticket.id}-${ticket.version}`,
          createdAt: nowIso()
        });
        events.push(`${ticket.ticketNo} 超时流转`);
      }
    }
    for (const scan of state.scans) {
      if (!scan.ticketId || scan.batchLockStatus !== "QC_HOLD") continue;
      const ticket = state.tickets.find((item) => item.id === scan.ticketId);
      if (!ticket || !isOpenStatus(ticket.status)) continue;
      const heldFor = now - new Date(scan.createdAt).getTime();
      if (heldFor > state.settings.qcHoldTimeoutMinutes * 60 * 1000 && ticket.status !== "LEVEL2_REVIEW") {
        const before = ticket.status;
        ticket.status = "LEVEL2_REVIEW";
        ticket.currentAssigneeId = chooseApprover(state, 2, ticket.tenantId, ticket.warehouseId)?.id;
        ticket.dueAt = approvalDueAt(state, 2);
        ticket.version += 1;
        ticket.updatedAt = nowIso();
        state.approvals.push({
          id: id("apv"),
          ticketId: ticket.id,
          operatorId: "system",
          level: 2,
          result: "AUTO_ESCALATED",
          comment: "品控暂扣超时，因压仓成本高于普通审批等待成本，强制升级二级审批。",
          beforeStatus: before,
          afterStatus: ticket.status,
          idempotencyKey: `qc-timeout-${ticket.id}-${ticket.version}`,
          createdAt: nowIso()
        });
        events.push(`${ticket.ticketNo} 品控暂扣超时升级`);
      }
    }
    return { ok: true, events };
  });
}

export function listTicketsFromState(state: AppState, query: TicketListQuery) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(50, Math.max(5, Number(query.pageSize || 12)));
  let items = [...state.tickets];
  if (query.status && query.status !== "ALL") items = items.filter((item) => item.status === query.status);
  if (query.exceptionClass && query.exceptionClass !== "ALL") items = items.filter((item) => item.exceptionClass === query.exceptionClass);
  if (query.exceptionType && query.exceptionType !== "ALL") items = items.filter((item) => item.exceptionType === query.exceptionType);
  if (query.waybillNo) items = items.filter((item) => item.waybillNo.includes(query.waybillNo || ""));
  if (query.assigneeId) items = items.filter((item) => item.currentAssigneeId === query.assigneeId);
  const total = items.length;
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  const stats = {
    total: state.tickets.length,
    open: state.tickets.filter((item) => isOpenStatus(item.status)).length,
    quality: state.tickets.filter((item) => item.exceptionClass === "QUALITY").length,
    overdue: state.tickets.filter((item) => isOpenStatus(item.status) && new Date(item.dueAt).getTime() < Date.now()).length
  };
  return { items: paged, total, page, pageSize, stats };
}

export function ticketDetailFromState(state: AppState, ticketId: string): TicketDetail {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) {
    throw new DomainError("工单不存在", 404);
  }
  return {
    ...ticket,
    reporter: state.users.find((item) => item.id === ticket.reporterId),
    assignee: state.users.find((item) => item.id === ticket.currentAssigneeId),
    waybill: state.waybillSnapshots.find((item) => item.waybillNo === ticket.waybillNo),
    approvals: state.approvals.filter((item) => item.ticketId === ticket.id),
    scans: state.scans.filter((item) => item.ticketId === ticket.id),
    compensations: state.compensations.filter((item) => item.ticketId === ticket.id),
    inventoryMovements: state.inventoryMovements.filter((item) => item.ticketId === ticket.id)
  };
}

export function nextActionLabel(ticket: Ticket) {
  if (ticket.exceptionClass === "QUALITY") return qualityAction(ticket.exceptionType);
  return logisticsAction(ticket.exceptionType);
}

export function ticketTitle(ticket: Ticket) {
  return `${ticket.ticketNo} · ${exceptionLabels[ticket.exceptionType]}`;
}
