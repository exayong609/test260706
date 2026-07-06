export type Role =
  | "OPERATOR"
  | "LEVEL1_APPROVER"
  | "LEVEL2_APPROVER"
  | "QC_SUPERVISOR"
  | "ADMIN";

export type TicketSource = "MANUAL" | "SCAN";
export type ExceptionClass = "LOGISTICS" | "QUALITY";

export type LogisticsExceptionType =
  | "LOST"
  | "DAMAGED"
  | "REJECTED"
  | "TIMEOUT"
  | "ADDRESS_ERROR";

export type QualityExceptionType =
  | "QUANTITY_MISMATCH"
  | "APPEARANCE_DAMAGED"
  | "SPEC_MISMATCH"
  | "LABEL_ERROR"
  | "BATCH_ABNORMAL";

export type ExceptionType = LogisticsExceptionType | QualityExceptionType;

export type TicketStatus =
  | "PENDING_REVIEW"
  | "LEVEL1_REVIEW"
  | "LEVEL2_REVIEW"
  | "REJECTED_PENDING_RESUBMIT"
  | "EXECUTING"
  | "COMPLETED"
  | "AUTO_CLOSED"
  | "FAST_RELEASED";

export type ApprovalResult =
  | "APPROVED"
  | "REJECTED"
  | "AUTO_ESCALATED"
  | "AUTO_REJECTED"
  | "RESUBMITTED"
  | "FAST_RELEASED"
  | "TRANSFERRED";

export type CompensationDirection = "PAY_CUSTOMER" | "SUPPLIER_RECOVERY";
export type BatchLockStatus = "AVAILABLE" | "QC_HOLD" | "RELEASED" | "SCRAPPED" | "RETURNED";
export type QcResult = "PASS" | "ABNORMAL";

export interface User {
  id: string;
  name: string;
  role: Role;
  tenantId: string;
  warehouseId: string;
  active: boolean;
}

export interface WaybillSkuLine {
  sku: string;
  name: string;
  qty: number;
  batchNo: string;
}

export interface WaybillSnapshot {
  waybillNo: string;
  sender: string;
  receiver: string;
  receiverPhone: string;
  address: string;
  amountCents: number;
  tenantId: string;
  warehouseId: string;
  status: string;
  skuLines: WaybillSkuLine[];
  source: "V2_REALTIME" | "V3_CACHE";
  syncedAt: string;
  version: string;
  stale: boolean;
}

export interface InterfaceSyncLog {
  id: string;
  requestId: string;
  endpoint: string;
  paramsSummary: string;
  statusCode: number;
  success: boolean;
  durationMs: number;
  error?: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  ticketNo: string;
  source: TicketSource;
  exceptionClass: ExceptionClass;
  exceptionType: ExceptionType;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  waybillNo: string;
  sku?: string;
  batchNo?: string;
  amountCents: number;
  description: string;
  reporterId: string;
  tenantId: string;
  warehouseId: string;
  status: TicketStatus;
  requiredLevel: 1 | 2;
  currentAssigneeId?: string;
  retryCount: number;
  version: number;
  dueAt: string;
  sourceSyncAt: string;
  waybillSource: WaybillSnapshot["source"];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  executionAction?: string;
  aiSuggestion?: AiSuggestion;
}

export interface AiSuggestion {
  enabled: boolean;
  label: string;
  confidence: number;
  reason: string;
  basedOnTicketNos: string[];
}

export interface ApprovalRecord {
  id: string;
  ticketId: string;
  operatorId: string;
  level: 1 | 2 | 0;
  result: ApprovalResult;
  comment: string;
  beforeStatus: TicketStatus;
  afterStatus: TicketStatus;
  idempotencyKey: string;
  createdAt: string;
}

export interface CompensationRecord {
  id: string;
  ticketId: string;
  approvalRecordId: string;
  direction: CompensationDirection;
  amountCents: number;
  status: "PENDING_RECONCILIATION" | "RECONCILED";
  reconciliationMethod: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  batchNo: string;
  warehouseId: string;
  tenantId: string;
  availableQty: number;
  lockedQty: number;
  lockTicketId?: string;
  lockStatus: BatchLockStatus;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  sku: string;
  batchNo: string;
  changeQty: number;
  reason: string;
  ticketId: string;
  approvalRecordId: string;
  createdAt: string;
}

export interface ScanRecord {
  id: string;
  scanId: string;
  waybillNo: string;
  sku: string;
  batchNo: string;
  scannedQty: number;
  expectedQty: number;
  damageLevel: number;
  specVarianceMm: number;
  labelReadable: boolean;
  operatorId: string;
  deviceId: string;
  qcResult: QcResult;
  exceptionDescription: string;
  matchedRuleId?: string;
  ruleTrace: string;
  batchLockStatus: BatchLockStatus;
  ticketId?: string;
  createdAt: string;
}

export interface QualityRule {
  id: string;
  name: string;
  subtype: QualityExceptionType;
  field: "quantityDeltaPct" | "damageLevel" | "specVarianceMm" | "labelReadable" | "batchAgeDays";
  operator: ">" | ">=" | "=" | "!=";
  threshold: number | boolean;
  severity: Ticket["severity"];
  autoCreateTicket: boolean;
  targetApprovalLevel: 1 | 2;
  enabled: boolean;
  updatedAt: string;
}

export interface ApprovalRule {
  id: string;
  name: string;
  minAmountCents: number;
  maxAmountCents?: number;
  requiredLevel: 1 | 2;
  timeoutHours: number;
  enabled: boolean;
}

export interface SystemSettings {
  maxResubmitCount: number;
  qcHoldTimeoutMinutes: number;
  level1FallbackUserId: string;
  level2FallbackUserId: string;
}

export interface AppState {
  users: User[];
  waybillSnapshots: WaybillSnapshot[];
  interfaceLogs: InterfaceSyncLog[];
  tickets: Ticket[];
  approvals: ApprovalRecord[];
  compensations: CompensationRecord[];
  inventory: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  scans: ScanRecord[];
  qualityRules: QualityRule[];
  approvalRules: ApprovalRule[];
  settings: SystemSettings;
}

export interface TicketListQuery {
  status?: TicketStatus | "ALL";
  exceptionClass?: ExceptionClass | "ALL";
  exceptionType?: ExceptionType | "ALL";
  waybillNo?: string;
  assigneeId?: string;
  page?: number;
  pageSize?: number;
}

export interface TicketDetail extends Ticket {
  reporter?: User;
  assignee?: User;
  waybill?: WaybillSnapshot;
  approvals: ApprovalRecord[];
  scans: ScanRecord[];
  compensations: CompensationRecord[];
  inventoryMovements: InventoryMovement[];
}

export const statusLabels: Record<TicketStatus, string> = {
  PENDING_REVIEW: "待审批",
  LEVEL1_REVIEW: "一级审批中",
  LEVEL2_REVIEW: "二级审批中",
  REJECTED_PENDING_RESUBMIT: "拒绝待重提",
  EXECUTING: "执行中",
  COMPLETED: "已完成",
  AUTO_CLOSED: "自动关闭",
  FAST_RELEASED: "快速放行"
};

export const exceptionLabels: Record<ExceptionType, string> = {
  LOST: "物流丢件",
  DAMAGED: "运输破损",
  REJECTED: "客户拒收",
  TIMEOUT: "超时未签收",
  ADDRESS_ERROR: "地址错误",
  QUANTITY_MISMATCH: "数量不符",
  APPEARANCE_DAMAGED: "外观破损",
  SPEC_MISMATCH: "规格不符",
  LABEL_ERROR: "标签错误",
  BATCH_ABNORMAL: "批次异常"
};

export const roleLabels: Record<Role, string> = {
  OPERATOR: "操作员",
  LEVEL1_APPROVER: "一级审批人",
  LEVEL2_APPROVER: "二级审批人",
  QC_SUPERVISOR: "品控主管",
  ADMIN: "系统管理员"
};
