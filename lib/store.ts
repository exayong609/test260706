import { Pool, type PoolClient } from "pg";
import type {
  AppState,
  ApprovalRecord,
  ApprovalRule,
  CompensationRecord,
  InterfaceSyncLog,
  InventoryItem,
  InventoryMovement,
  QualityRule,
  ScanRecord,
  Ticket,
  User,
  WaybillSnapshot
} from "./types";
import { createSeedState } from "./seed";

type MutableState<T> = (state: AppState) => T | Promise<T>;

declare global {
  // eslint-disable-next-line no-var
  var __jingtianV3MemoryState: AppState | undefined;
  // eslint-disable-next-line no-var
  var __jingtianV3Pool: Pool | undefined;
}

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

function pool() {
  if (!globalThis.__jingtianV3Pool) {
    globalThis.__jingtianV3Pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
    });
  }
  return globalThis.__jingtianV3Pool;
}

function memoryState() {
  if (!globalThis.__jingtianV3MemoryState) {
    globalThis.__jingtianV3MemoryState = createSeedState();
  }
  return globalThis.__jingtianV3MemoryState;
}

async function ensureSchema(client: PoolClient) {
  await client.query(`
    create table if not exists v3_users (
      id text primary key,
      name text not null,
      role text not null,
      tenant_id text not null,
      warehouse_id text not null,
      active boolean not null
    );
    create table if not exists v3_waybill_snapshots (
      waybill_no text primary key,
      sender text not null,
      receiver text not null,
      receiver_phone text not null,
      address text not null,
      amount_cents integer not null,
      tenant_id text not null,
      warehouse_id text not null,
      status text not null,
      sku_lines jsonb not null,
      source text not null,
      synced_at timestamptz not null,
      version text not null,
      stale boolean not null
    );
    create table if not exists v3_interface_sync_logs (
      id text primary key,
      request_id text not null,
      endpoint text not null,
      params_summary text not null,
      status_code integer not null,
      success boolean not null,
      duration_ms integer not null,
      error text,
      created_at timestamptz not null
    );
    create table if not exists v3_tickets (
      id text primary key,
      ticket_no text not null unique,
      source text not null,
      exception_class text not null,
      exception_type text not null,
      severity text not null,
      waybill_no text not null,
      sku text,
      batch_no text,
      amount_cents integer not null,
      description text not null,
      reporter_id text not null,
      tenant_id text not null,
      warehouse_id text not null,
      status text not null,
      required_level integer not null,
      current_assignee_id text,
      retry_count integer not null,
      version integer not null,
      due_at timestamptz not null,
      source_sync_at timestamptz not null,
      waybill_source text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      completed_at timestamptz,
      execution_action text,
      ai_suggestion jsonb
    );
    create table if not exists v3_approval_records (
      id text primary key,
      ticket_id text not null,
      operator_id text not null,
      level integer not null,
      result text not null,
      comment text not null,
      before_status text not null,
      after_status text not null,
      idempotency_key text not null unique,
      created_at timestamptz not null
    );
    create table if not exists v3_compensation_records (
      id text primary key,
      ticket_id text not null,
      approval_record_id text not null,
      direction text not null,
      amount_cents integer not null,
      status text not null,
      reconciliation_method text not null,
      created_at timestamptz not null
    );
    create table if not exists v3_inventory (
      id text primary key,
      sku text not null,
      batch_no text not null,
      warehouse_id text not null,
      tenant_id text not null,
      available_qty integer not null,
      locked_qty integer not null,
      lock_ticket_id text,
      lock_status text not null,
      updated_at timestamptz not null,
      unique (sku, batch_no, warehouse_id, tenant_id)
    );
    create table if not exists v3_inventory_movements (
      id text primary key,
      sku text not null,
      batch_no text not null,
      change_qty integer not null,
      reason text not null,
      ticket_id text not null,
      approval_record_id text not null,
      created_at timestamptz not null
    );
    create table if not exists v3_scan_records (
      id text primary key,
      scan_id text not null unique,
      waybill_no text not null,
      sku text not null,
      batch_no text not null,
      scanned_qty integer not null,
      expected_qty integer not null,
      damage_level integer not null,
      spec_variance_mm integer not null,
      label_readable boolean not null,
      operator_id text not null,
      device_id text not null,
      qc_result text not null,
      exception_description text not null,
      matched_rule_id text,
      rule_trace text not null,
      batch_lock_status text not null,
      ticket_id text,
      created_at timestamptz not null
    );
    create table if not exists v3_quality_rules (
      id text primary key,
      name text not null,
      subtype text not null,
      field text not null,
      operator text not null,
      threshold jsonb not null,
      severity text not null,
      auto_create_ticket boolean not null,
      target_approval_level integer not null,
      enabled boolean not null,
      updated_at timestamptz not null
    );
    create table if not exists v3_approval_rules (
      id text primary key,
      name text not null,
      min_amount_cents integer not null,
      max_amount_cents integer,
      required_level integer not null,
      timeout_hours integer not null,
      enabled boolean not null
    );
    create table if not exists v3_system_settings (
      id text primary key,
      value jsonb not null
    );
  `);

  const existing = await client.query<{ count: string }>("select count(*)::text as count from v3_users");
  if (Number(existing.rows[0]?.count ?? 0) === 0) {
    await saveState(createSeedState(), client);
  }
}

async function loadState(client: PoolClient): Promise<AppState> {
  const [
    users,
    snapshots,
    logs,
    tickets,
    approvals,
    compensations,
    inventory,
    movements,
    scans,
    qualityRules,
    approvalRules,
    settings
  ] = await Promise.all([
    client.query("select * from v3_users order by id"),
    client.query("select * from v3_waybill_snapshots order by waybill_no"),
    client.query("select * from v3_interface_sync_logs order by created_at desc limit 500"),
    client.query("select * from v3_tickets order by created_at desc"),
    client.query("select * from v3_approval_records order by created_at asc"),
    client.query("select * from v3_compensation_records order by created_at asc"),
    client.query("select * from v3_inventory order by sku, batch_no"),
    client.query("select * from v3_inventory_movements order by created_at asc"),
    client.query("select * from v3_scan_records order by created_at asc"),
    client.query("select * from v3_quality_rules order by id"),
    client.query("select * from v3_approval_rules order by min_amount_cents"),
    client.query("select value from v3_system_settings where id = 'default'")
  ]);

  return {
    users: users.rows.map(
      (row): User => ({
        id: row.id,
        name: row.name,
        role: row.role,
        tenantId: row.tenant_id,
        warehouseId: row.warehouse_id,
        active: row.active
      })
    ),
    waybillSnapshots: snapshots.rows.map(
      (row): WaybillSnapshot => ({
        waybillNo: row.waybill_no,
        sender: row.sender,
        receiver: row.receiver,
        receiverPhone: row.receiver_phone,
        address: row.address,
        amountCents: row.amount_cents,
        tenantId: row.tenant_id,
        warehouseId: row.warehouse_id,
        status: row.status,
        skuLines: row.sku_lines,
        source: row.source,
        syncedAt: new Date(row.synced_at).toISOString(),
        version: row.version,
        stale: row.stale
      })
    ),
    interfaceLogs: logs.rows.map(
      (row): InterfaceSyncLog => ({
        id: row.id,
        requestId: row.request_id,
        endpoint: row.endpoint,
        paramsSummary: row.params_summary,
        statusCode: row.status_code,
        success: row.success,
        durationMs: row.duration_ms,
        error: row.error ?? undefined,
        createdAt: new Date(row.created_at).toISOString()
      })
    ),
    tickets: tickets.rows.map(
      (row): Ticket => ({
        id: row.id,
        ticketNo: row.ticket_no,
        source: row.source,
        exceptionClass: row.exception_class,
        exceptionType: row.exception_type,
        severity: row.severity,
        waybillNo: row.waybill_no,
        sku: row.sku ?? undefined,
        batchNo: row.batch_no ?? undefined,
        amountCents: row.amount_cents,
        description: row.description,
        reporterId: row.reporter_id,
        tenantId: row.tenant_id,
        warehouseId: row.warehouse_id,
        status: row.status,
        requiredLevel: row.required_level,
        currentAssigneeId: row.current_assignee_id ?? undefined,
        retryCount: row.retry_count,
        version: row.version,
        dueAt: new Date(row.due_at).toISOString(),
        sourceSyncAt: new Date(row.source_sync_at).toISOString(),
        waybillSource: row.waybill_source,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
        executionAction: row.execution_action ?? undefined,
        aiSuggestion: row.ai_suggestion ?? undefined
      })
    ),
    approvals: approvals.rows.map(
      (row): ApprovalRecord => ({
        id: row.id,
        ticketId: row.ticket_id,
        operatorId: row.operator_id,
        level: row.level,
        result: row.result,
        comment: row.comment,
        beforeStatus: row.before_status,
        afterStatus: row.after_status,
        idempotencyKey: row.idempotency_key,
        createdAt: new Date(row.created_at).toISOString()
      })
    ),
    compensations: compensations.rows.map(
      (row): CompensationRecord => ({
        id: row.id,
        ticketId: row.ticket_id,
        approvalRecordId: row.approval_record_id,
        direction: row.direction,
        amountCents: row.amount_cents,
        status: row.status,
        reconciliationMethod: row.reconciliation_method,
        createdAt: new Date(row.created_at).toISOString()
      })
    ),
    inventory: inventory.rows.map(
      (row): InventoryItem => ({
        id: row.id,
        sku: row.sku,
        batchNo: row.batch_no,
        warehouseId: row.warehouse_id,
        tenantId: row.tenant_id,
        availableQty: row.available_qty,
        lockedQty: row.locked_qty,
        lockTicketId: row.lock_ticket_id ?? undefined,
        lockStatus: row.lock_status,
        updatedAt: new Date(row.updated_at).toISOString()
      })
    ),
    inventoryMovements: movements.rows.map(
      (row): InventoryMovement => ({
        id: row.id,
        sku: row.sku,
        batchNo: row.batch_no,
        changeQty: row.change_qty,
        reason: row.reason,
        ticketId: row.ticket_id,
        approvalRecordId: row.approval_record_id,
        createdAt: new Date(row.created_at).toISOString()
      })
    ),
    scans: scans.rows.map(
      (row): ScanRecord => ({
        id: row.id,
        scanId: row.scan_id,
        waybillNo: row.waybill_no,
        sku: row.sku,
        batchNo: row.batch_no,
        scannedQty: row.scanned_qty,
        expectedQty: row.expected_qty,
        damageLevel: row.damage_level,
        specVarianceMm: row.spec_variance_mm,
        labelReadable: row.label_readable,
        operatorId: row.operator_id,
        deviceId: row.device_id,
        qcResult: row.qc_result,
        exceptionDescription: row.exception_description,
        matchedRuleId: row.matched_rule_id ?? undefined,
        ruleTrace: row.rule_trace,
        batchLockStatus: row.batch_lock_status,
        ticketId: row.ticket_id ?? undefined,
        createdAt: new Date(row.created_at).toISOString()
      })
    ),
    qualityRules: qualityRules.rows.map(
      (row): QualityRule => ({
        id: row.id,
        name: row.name,
        subtype: row.subtype,
        field: row.field,
        operator: row.operator,
        threshold: row.threshold,
        severity: row.severity,
        autoCreateTicket: row.auto_create_ticket,
        targetApprovalLevel: row.target_approval_level,
        enabled: row.enabled,
        updatedAt: new Date(row.updated_at).toISOString()
      })
    ),
    approvalRules: approvalRules.rows.map(
      (row): ApprovalRule => ({
        id: row.id,
        name: row.name,
        minAmountCents: row.min_amount_cents,
        maxAmountCents: row.max_amount_cents ?? undefined,
        requiredLevel: row.required_level,
        timeoutHours: row.timeout_hours,
        enabled: row.enabled
      })
    ),
    settings: settings.rows[0]?.value ?? createSeedState().settings
  };
}

async function saveState(state: AppState, client: PoolClient) {
  await client.query(`
    delete from v3_inventory_movements;
    delete from v3_compensation_records;
    delete from v3_approval_records;
    delete from v3_scan_records;
    delete from v3_tickets;
    delete from v3_interface_sync_logs;
    delete from v3_waybill_snapshots;
    delete from v3_inventory;
    delete from v3_quality_rules;
    delete from v3_approval_rules;
    delete from v3_system_settings;
    delete from v3_users;
  `);

  for (const item of state.users) {
    await client.query("insert into v3_users values ($1,$2,$3,$4,$5,$6)", [
      item.id,
      item.name,
      item.role,
      item.tenantId,
      item.warehouseId,
      item.active
    ]);
  }
  for (const item of state.waybillSnapshots) {
    await client.query(
      "insert into v3_waybill_snapshots values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)",
      [
        item.waybillNo,
        item.sender,
        item.receiver,
        item.receiverPhone,
        item.address,
        item.amountCents,
        item.tenantId,
        item.warehouseId,
        item.status,
        JSON.stringify(item.skuLines),
        item.source,
        item.syncedAt,
        item.version,
        item.stale
      ]
    );
  }
  for (const item of state.interfaceLogs.slice(0, 500)) {
    await client.query("insert into v3_interface_sync_logs values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      item.id,
      item.requestId,
      item.endpoint,
      item.paramsSummary,
      item.statusCode,
      item.success,
      item.durationMs,
      item.error ?? null,
      item.createdAt
    ]);
  }
  for (const item of state.inventory) {
    await client.query("insert into v3_inventory values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
      item.id,
      item.sku,
      item.batchNo,
      item.warehouseId,
      item.tenantId,
      item.availableQty,
      item.lockedQty,
      item.lockTicketId ?? null,
      item.lockStatus,
      item.updatedAt
    ]);
  }
  for (const item of state.tickets) {
    await client.query(
      "insert into v3_tickets values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb)",
      [
        item.id,
        item.ticketNo,
        item.source,
        item.exceptionClass,
        item.exceptionType,
        item.severity,
        item.waybillNo,
        item.sku ?? null,
        item.batchNo ?? null,
        item.amountCents,
        item.description,
        item.reporterId,
        item.tenantId,
        item.warehouseId,
        item.status,
        item.requiredLevel,
        item.currentAssigneeId ?? null,
        item.retryCount,
        item.version,
        item.dueAt,
        item.sourceSyncAt,
        item.waybillSource,
        item.createdAt,
        item.updatedAt,
        item.completedAt ?? null,
        item.executionAction ?? null,
        JSON.stringify(item.aiSuggestion ?? null)
      ]
    );
  }
  for (const item of state.scans) {
    await client.query(
      "insert into v3_scan_records values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
      [
        item.id,
        item.scanId,
        item.waybillNo,
        item.sku,
        item.batchNo,
        item.scannedQty,
        item.expectedQty,
        item.damageLevel,
        item.specVarianceMm,
        item.labelReadable,
        item.operatorId,
        item.deviceId,
        item.qcResult,
        item.exceptionDescription,
        item.matchedRuleId ?? null,
        item.ruleTrace,
        item.batchLockStatus,
        item.ticketId ?? null,
        item.createdAt
      ]
    );
  }
  for (const item of state.approvals) {
    await client.query("insert into v3_approval_records values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
      item.id,
      item.ticketId,
      item.operatorId,
      item.level,
      item.result,
      item.comment,
      item.beforeStatus,
      item.afterStatus,
      item.idempotencyKey,
      item.createdAt
    ]);
  }
  for (const item of state.compensations) {
    await client.query("insert into v3_compensation_records values ($1,$2,$3,$4,$5,$6,$7,$8)", [
      item.id,
      item.ticketId,
      item.approvalRecordId,
      item.direction,
      item.amountCents,
      item.status,
      item.reconciliationMethod,
      item.createdAt
    ]);
  }
  for (const item of state.inventoryMovements) {
    await client.query("insert into v3_inventory_movements values ($1,$2,$3,$4,$5,$6,$7,$8)", [
      item.id,
      item.sku,
      item.batchNo,
      item.changeQty,
      item.reason,
      item.ticketId,
      item.approvalRecordId,
      item.createdAt
    ]);
  }
  for (const item of state.qualityRules) {
    await client.query("insert into v3_quality_rules values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)", [
      item.id,
      item.name,
      item.subtype,
      item.field,
      item.operator,
      JSON.stringify(item.threshold),
      item.severity,
      item.autoCreateTicket,
      item.targetApprovalLevel,
      item.enabled,
      item.updatedAt
    ]);
  }
  for (const item of state.approvalRules) {
    await client.query("insert into v3_approval_rules values ($1,$2,$3,$4,$5,$6,$7)", [
      item.id,
      item.name,
      item.minAmountCents,
      item.maxAmountCents ?? null,
      item.requiredLevel,
      item.timeoutHours,
      item.enabled
    ]);
  }
  await client.query("insert into v3_system_settings values ('default', $1::jsonb)", [JSON.stringify(state.settings)]);
}

async function lockedTransaction<T>(fn: (state: AppState) => T | Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await ensureSchema(client);
    await client.query(`
      lock table
        v3_tickets,
        v3_approval_records,
        v3_compensation_records,
        v3_inventory,
        v3_inventory_movements,
        v3_scan_records,
        v3_waybill_snapshots,
        v3_interface_sync_logs,
        v3_quality_rules,
        v3_approval_rules,
        v3_users,
        v3_system_settings
      in exclusive mode
    `);
    const state = await loadState(client);
    const result = await fn(state);
    await saveState(state, client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function readState<T>(fn: (state: AppState) => T | Promise<T>): Promise<T> {
  if (!hasDatabase()) {
    return fn(structuredClone(memoryState()));
  }
  const client = await pool().connect();
  try {
    await ensureSchema(client);
    const state = await loadState(client);
    return fn(state);
  } finally {
    client.release();
  }
}

export async function writeState<T>(fn: MutableState<T>): Promise<T> {
  if (!hasDatabase()) {
    const draft = structuredClone(memoryState());
    const result = await fn(draft);
    globalThis.__jingtianV3MemoryState = draft;
    return result;
  }
  return lockedTransaction(fn);
}

export async function resetDemoState() {
  return writeState((state) => {
    const fresh = createSeedState();
    Object.assign(state, fresh);
    return { ok: true };
  });
}
