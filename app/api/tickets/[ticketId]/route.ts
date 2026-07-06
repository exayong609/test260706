import { NextResponse } from "next/server";
import { DomainError, ticketDetailFromState } from "@/lib/domain";
import { readState } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ ticketId: string }> }) {
  try {
    const { ticketId } = await context.params;
    const data = await readState((state) => ticketDetailFromState(state, ticketId));
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
