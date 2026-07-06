# 鲸天 V3 运单全流程管理系统

V3 是独立部署的 Next.js App Router + TypeScript 项目，覆盖运单快照同步、扫描品控、物流异常上报、分级审批、赔付与库存联动、接口监控。

## 快速运行

```bash
npm install
npm run dev
```

本地打开 http://localhost:3000。

没有配置 `DATABASE_URL` 时，系统使用进程内演示数据，包含 220 条异常工单、品控规则、审批规则、库存和赔付记录，方便评审直接操作。生产部署请配置独立 V3 数据库连接。

## 环境变量

```bash
DATABASE_URL=postgres://...
V2_API_BASE_URL=https://v2.example.com/api/v1
V2_API_KEY=replace-with-real-token
NEXT_PUBLIC_APP_URL=https://your-v3.vercel.app
CRON_SECRET=optional-cron-secret
```

`DATABASE_URL` 必须指向 V3 自己的 Neon/Supabase/Vercel Postgres 实例，不能复用 V2 数据库。若 `V2_API_BASE_URL` 为空，系统会调用本项目内置的 `/api/mock-v2` HTTP 路由，用于演示真实 HTTP 对接、鉴权、超时、重试和接口日志链路。

## Vercel 部署

1. 将代码推送到 GitHub。
2. 在 Vercel 新建独立项目，选择该仓库。
3. 配置 `DATABASE_URL`、`V2_API_BASE_URL`、`V2_API_KEY`、`NEXT_PUBLIC_APP_URL`。
4. Build Command 使用 `npm run build`，Install Command 使用 `npm install`。
5. 可选：在 Vercel Cron 中定时请求 `/api/jobs/run`，Vercel Hobby 账号配置为每日一次；Pro 账号可调高频率。Vercel 会使用 `Authorization: Bearer ${CRON_SECRET}`；手动调用也可带 `x-cron-secret: CRON_SECRET`，触发超时流转和禁用审批人转交。

## 评分点对应

- 扫描品控：`/api/scan` 调 V2 校验 SKU 归属，命中可配置品控规则后创建扫描来源工单并锁定批次。
- 异常上报：`/api/tickets` 实时调用 V2 校验运单存在，不允许只凭本地快照创建关键工单。
- 审批状态机：`/api/tickets/[ticketId]/approve` 使用版本号处理并发冲突，使用 `idempotencyKey` 防重复审批。
- 执行联动：审批完成后在同一服务端事务内生成赔付记录、库存变更记录，并关联审批记录 ID。
- 接口监控：`/api/interface-logs` 展示 Request ID、接口、入参摘要、状态码、耗时、错误信息。
- 后台任务：`/api/jobs/run` 执行审批超时升级/关闭、品控暂扣超时升级、禁用审批人转交。
- 文档：见 [docs/api-contract.md](docs/api-contract.md) 和 [docs/assumptions.md](docs/assumptions.md)。

## 数据库说明

项目启动时会自动创建 `v3_*` 表并写入种子数据。生产环境建议用迁移工具托管同等 DDL；当前实现为了考试可直接部署，保留了自动建表逻辑。

核心表：

- `v3_waybill_snapshots`：V3 本地只读运单快照。
- `v3_interface_sync_logs`：V2 调用链路日志。
- `v3_tickets`：异常工单。
- `v3_approval_records`：审批和系统流转审计。
- `v3_compensation_records`：客户赔付/供应商追偿。
- `v3_inventory`、`v3_inventory_movements`：库存锁定和变更。
- `v3_scan_records`：扫描记录，与工单通过 `ticket_id` 关联。
- `v3_quality_rules`、`v3_approval_rules`：可配置规则。
