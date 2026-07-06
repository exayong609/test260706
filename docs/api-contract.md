# V3 调用 V2 接口契约

本文档描述 V3 与 V2 的 HTTP 接口契约。V3 不直接连接 V2 数据库；所有运单主数据、SKU 归属校验和列表同步均通过 HTTP API 完成。

## 鉴权

V3 调用 V2 时带 Header：

```http
x-api-key: ${V2_API_KEY}
```

V2 应返回：

- `401 Unauthorized`：API Key 缺失或错误。
- `403 Forbidden`：API Key 有效但无租户/仓库权限。

## 通用要求

- V3 每次请求生成 `requestId`，写入 `v3_interface_sync_logs`。
- 日志字段包含：调用时间、接口名、入参摘要、响应状态码、耗时、成功标记、错误信息。
- 客户端超时：2500ms。
- 重试：最多 2 次。`404` 和 `401` 不重试，网络错误/5xx/超时重试一次。
- 幂等性：GET 校验和查询接口天然幂等；可选回写接口需使用 `Idempotency-Key`。

## 1. 获取运单详情

```http
GET /api/v1/waybills/{waybillNo}
```

返回：

```json
{
  "waybillNo": "JT2026070001",
  "sender": "鲸天上海中心仓",
  "receiver": "林一",
  "receiverPhone": "13800000000",
  "address": "上海市浦东新区...",
  "amountCents": 68000,
  "tenantId": "TENANT-A",
  "warehouseId": "WH-EAST",
  "status": "READY_TO_SHIP",
  "skuLines": [
    { "sku": "SKU-A100", "name": "鲸天净化滤芯", "qty": 2, "batchNo": "B20260701" }
  ],
  "syncedAt": "2026-07-06T04:00:00.000Z",
  "version": "v2-1-0"
}
```

V3 用途：

- 手工上报时强制实时校验运单存在。
- 刷新本地只读快照。
- 工单详情展示数据来源。

## 2. 校验 SKU 是否属于运单

```http
GET /api/v1/waybills/{waybillNo}/skus/{sku}
```

返回：

```json
{
  "ok": true,
  "waybill": { "...": "同运单详情" },
  "line": { "sku": "SKU-A100", "name": "鲸天净化滤芯", "qty": 2, "batchNo": "B20260701" }
}
```

V3 用途：

- 扫描录入前校验 SKU 真实归属于该运单。
- 防止无关 SKU 被扫描进品控链路。

失败语义：

- `404`：运单不存在或 SKU 不属于该运单，V3 阻断扫描。
- `503/timeout`：V3 提示 V2 不可用，扫描这种关键动作不使用缓存替代。

## 3. 运单列表同步

```http
GET /api/v1/waybills?updatedAfter=2026-07-06T00:00:00.000Z&limit=100
```

返回：

```json
{
  "items": [
    { "...": "同运单详情" }
  ],
  "nextCursor": "optional-cursor"
}
```

V3 用途：

- 初始化本地快照。
- 定时增量同步。
- V2 不可用时以缓存方式展示，并明确标注同步时间。

## 4. 可选：异常状态回写 V2

```http
POST /api/v1/waybills/{waybillNo}/exception-marker
Idempotency-Key: v3-ticket-id
```

请求：

```json
{
  "ticketId": "ticket_xxx",
  "ticketNo": "V3-000221",
  "status": "LEVEL2_REVIEW",
  "source": "SCAN",
  "summary": "该运单存在未关闭品控异常"
}
```

V3 当前版本把回写列为扩展项，不阻塞主流程。若接入生产 V2，建议使用此接口防止 V2 继续按正常运单重复发货。

## V2 不可用时的降级

- 列表和详情可使用 `v3_waybill_snapshots` 本地缓存展示，并标注“本地缓存，同步于 XX 时间”。
- 手工上报和扫描这类关键写入动作必须实时校验 V2，V2 不可用时阻断并提示，不使用缓存伪造真实性校验。
- 接口恢复后，下一次详情获取/上报/扫描会自动刷新本地快照。

## 存量 V2 二开策略

如果 V2 原本没有接口，新增接口应遵循：

- 版本化路径：新增 `/api/v1/...`，不修改原有内部路由。
- 字段向后兼容：只新增字段，不删除、不改名；金额字段建议统一以 `amountCents` 整数传输。
- 灰度上线：先开放只读查询和 SKU 校验，观察日志，再开启可选回写。
- 契约测试：V3 CI 固定校验 V2 JSON Schema；V2 字段升级时先双写旧字段和新字段。
- 金额类型变更：若 V2 从 `int` 改为 `decimal`，V3 适配层先兼容字符串/数字 decimal，再转换为 cents，避免业务层直接依赖 V2 原始类型。
