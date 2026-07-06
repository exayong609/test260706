import { NextResponse } from "next/server";
import { runBackgroundJobs } from "@/lib/domain";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (secret && request.headers.get("x-cron-secret") !== secret && bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }
  const data = await runBackgroundJobs();
  return NextResponse.json(data);
}

export async function GET(request: Request) {
  return POST(request);
}
