import type { InterfaceSyncLog, WaybillSnapshot } from "./types";
import { id, nowIso, shortHash } from "./utils";

export class V2ClientError extends Error {
  logs: InterfaceSyncLog[];
  statusCode: number;

  constructor(message: string, logs: InterfaceSyncLog[], statusCode = 0) {
    super(message);
    this.name = "V2ClientError";
    this.logs = logs;
    this.statusCode = statusCode;
  }
}

function baseUrl() {
  if (process.env.V2_API_BASE_URL) {
    return process.env.V2_API_BASE_URL.replace(/\/$/, "");
  }
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${appUrl.replace(/\/$/, "")}/api/mock-v2`;
}

async function fetchJson<T>(endpoint: string, paramsSummary: unknown, init?: RequestInit): Promise<{ data: T; logs: InterfaceSyncLog[] }> {
  const logs: InterfaceSyncLog[] = [];
  const requestId = id("req");
  const url = `${baseUrl()}${endpoint}`;
  const maxAttempts = 2;
  let lastError = "未知错误";
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.V2_API_KEY || "demo-v2-key",
          ...(init?.headers ?? {})
        },
        signal: controller.signal,
        cache: "no-store"
      });
      const durationMs = Date.now() - started;
      lastStatus = response.status;
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        lastError = `V2 返回 ${response.status}: ${body.error ?? response.statusText}`;
        logs.push({
          id: id("log"),
          requestId,
          endpoint,
          paramsSummary: `${shortHash(paramsSummary)} attempt=${attempt}`,
          statusCode: response.status,
          success: false,
          durationMs,
          error: lastError,
          createdAt: nowIso()
        });
        if (response.status === 404 || response.status === 401) {
          break;
        }
        continue;
      }
      const data = (await response.json()) as T;
      logs.push({
        id: id("log"),
        requestId,
        endpoint,
        paramsSummary: `${shortHash(paramsSummary)} attempt=${attempt}`,
        statusCode: response.status,
        success: true,
        durationMs,
        createdAt: nowIso()
      });
      return { data, logs };
    } catch (error) {
      const durationMs = Date.now() - started;
      lastError = error instanceof Error && error.name === "AbortError" ? "V2 接口超时 2500ms" : error instanceof Error ? error.message : "网络错误";
      logs.push({
        id: id("log"),
        requestId,
        endpoint,
        paramsSummary: `${shortHash(paramsSummary)} attempt=${attempt}`,
        statusCode: 0,
        success: false,
        durationMs,
        error: lastError,
        createdAt: nowIso()
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new V2ClientError(lastError, logs, lastStatus);
}

export async function fetchWaybillFromV2(waybillNo: string) {
  return fetchJson<WaybillSnapshot>(`/waybills/${encodeURIComponent(waybillNo)}`, { waybillNo });
}

export async function validateSkuFromV2(waybillNo: string, sku: string) {
  return fetchJson<{ ok: boolean; waybill: WaybillSnapshot; line: WaybillSnapshot["skuLines"][number] }>(
    `/waybills/${encodeURIComponent(waybillNo)}/skus/${encodeURIComponent(sku)}`,
    { waybillNo, sku }
  );
}

export async function syncWaybillListFromV2(query = "") {
  return fetchJson<{ items: WaybillSnapshot[] }>(`/waybills${query}`, { query });
}
