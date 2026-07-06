import { NextResponse } from "next/server";
import { assertV2ApiKey, mockV2Waybills } from "@/lib/mock-v2";

export async function GET(request: Request) {
  if (!assertV2ApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized V2 API key" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get("q") || "";
  const items = mockV2Waybills().filter((item) => item.waybillNo.includes(keyword)).slice(0, 50);
  return NextResponse.json({ items });
}
