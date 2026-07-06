import { NextResponse } from "next/server";
import { assertV2ApiKey, findMockWaybill } from "@/lib/mock-v2";

export async function GET(
  request: Request,
  context: { params: Promise<{ waybillNo: string; sku: string }> }
) {
  if (!assertV2ApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized V2 API key" }, { status: 401 });
  }
  const { waybillNo, sku } = await context.params;
  const waybill = findMockWaybill(decodeURIComponent(waybillNo));
  if (!waybill) {
    return NextResponse.json({ error: `Waybill ${waybillNo} not found` }, { status: 404 });
  }
  const line = waybill.skuLines.find((item) => item.sku === decodeURIComponent(sku));
  if (!line) {
    return NextResponse.json({ error: `SKU ${sku} does not belong to ${waybillNo}` }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    waybill: { ...waybill, syncedAt: new Date().toISOString(), source: "V2_REALTIME" },
    line
  });
}
