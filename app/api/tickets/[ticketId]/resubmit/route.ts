import { NextResponse } from "next/server";
import { DomainError, resubmitTicket } from "@/lib/domain";

export async function POST(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  try {
    const { ticketId } = await context.params;
    const body = await request.json();
    const data = await resubmitTicket({
      ticketId,
      reporterId: body.reporterId,
      comment: body.comment
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
