import { NextResponse } from "next/server";
import { DomainError, scanWaybill } from "@/lib/domain";
import { safeNumber } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await scanWaybill({
      waybillNo: body.waybillNo,
      sku: body.sku,
      batchNo: body.batchNo,
      scannedQty: safeNumber(body.scannedQty, 1),
      damageLevel: safeNumber(body.damageLevel, 0),
      specVarianceMm: safeNumber(body.specVarianceMm, 0),
      labelReadable: Boolean(body.labelReadable),
      operatorId: body.operatorId,
      deviceId: body.deviceId,
      description: body.description
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
