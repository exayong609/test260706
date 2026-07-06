import { NextResponse } from "next/server";
import { DomainError, fastRelease } from "@/lib/domain";

export async function POST(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  try {
    const { ticketId } = await context.params;
    const body = await request.json();
    const data = await fastRelease({
      ticketId,
      operatorId: body.operatorId,
      reason: body.reason
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
