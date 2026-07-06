import type { WaybillSnapshot, WaybillSkuLine } from "./types";

const skuNames = [
  ["SKU-A100", "鲸天净化滤芯"],
  ["SKU-B220", "智能温控面板"],
  ["SKU-C310", "商用传感器"],
  ["SKU-D450", "冷链保温箱"],
  ["SKU-E520", "工业扫码模组"],
  ["SKU-F660", "仓储周转盒"],
  ["SKU-G780", "高精密标签纸"]
] as const;

function makeSkuLines(index: number): WaybillSkuLine[] {
  const first = skuNames[index % skuNames.length];
  const second = skuNames[(index + 2) % skuNames.length];
  return [
    {
      sku: first[0],
      name: first[1],
      qty: (index % 4) + 1,
      batchNo: `B${202607}${String((index % 16) + 1).padStart(2, "0")}`
    },
    {
      sku: second[0],
      name: second[1],
      qty: (index % 3) + 1,
      batchNo: `B${202606}${String((index % 13) + 1).padStart(2, "0")}`
    }
  ];
}

export function mockV2Waybills(): WaybillSnapshot[] {
  return Array.from({ length: 90 }).map((_, idx) => {
    const index = idx + 1;
    const tenantId = index % 9 === 0 ? "TENANT-B" : "TENANT-A";
    const warehouseId = index % 7 === 0 ? "WH-SOUTH" : "WH-EAST";
    return {
      waybillNo: `JT202607${String(index).padStart(4, "0")}`,
      sender: index % 2 === 0 ? "鲸天上海中心仓" : "鲸天杭州中心仓",
      receiver: ["林一", "陈宁", "王若云", "赵航", "周珂", "沈澜"][index % 6],
      receiverPhone: `138${String(60000000 + index * 793).slice(0, 8)}`,
      address: `${warehouseId === "WH-EAST" ? "上海市浦东新区" : "广州市黄埔区"}鲸天客户地址 ${index} 号`,
      amountCents: 18000 + (index % 28) * 9200 + (index % 5) * 1300,
      tenantId,
      warehouseId,
      status: index % 5 === 0 ? "IN_TRANSIT" : index % 6 === 0 ? "SIGNED" : "READY_TO_SHIP",
      skuLines: makeSkuLines(index),
      source: "V2_REALTIME",
      syncedAt: new Date(Date.UTC(2026, 6, 6, 4, index % 60, 0)).toISOString(),
      version: `v2-${index}-${index % 4}`,
      stale: false
    };
  });
}

export function findMockWaybill(waybillNo: string) {
  return mockV2Waybills().find((item) => item.waybillNo === waybillNo);
}

export function assertV2ApiKey(request: Request) {
  const configured = process.env.V2_API_KEY || "demo-v2-key";
  const provided = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return provided === configured;
}
