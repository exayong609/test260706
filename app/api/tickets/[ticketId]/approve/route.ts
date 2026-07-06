import { NextResponse } from "next/server";
import { approveTicket, DomainError } from "@/lib/domain";

export async function POST(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  try {
    const { ticketId } = await context.params;
    const body = await request.json();
    const data = await approveTicket({
      ticketId,
      operatorId: body.operatorId,
      result: body.result,
      comment: body.comment,
      expectedVersion: Number(body.expectedVersion),
      idempotencyKey: body.idempotencyKey
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
