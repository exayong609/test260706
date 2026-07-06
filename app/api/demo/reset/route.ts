import { NextResponse } from "next/server";
import { resetDemoState } from "@/lib/store";

export async function POST() {
  const data = await resetDemoState();
  return NextResponse.json(data);
}
