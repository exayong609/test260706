import { NextResponse } from "next/server";
import { readState } from "@/lib/store";

export async function GET() {
  const data = await readState((state) => {
    const total = state.interfaceLogs.length;
    const success = state.interfaceLogs.filter((item) => item.success).length;
    return {
      logs: state.interfaceLogs.slice(0, 50),
      lastSuccessAt: state.interfaceLogs.find((item) => item.success)?.createdAt,
      successRate: total === 0 ? 1 : success / total
    };
  });
  return NextResponse.json(data);
}
