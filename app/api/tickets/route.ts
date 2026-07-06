import { NextResponse } from "next/server";
import { createManualTicket, listTicketsFromState, DomainError } from "@/lib/domain";
import { readState } from "@/lib/store";
import type { TicketListQuery } from "@/lib/types";
import { safeNumber } from "@/lib/utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query: TicketListQuery = {
    status: (searchParams.get("status") as TicketListQuery["status"]) || "ALL",
    exceptionClass: (searchParams.get("exceptionClass") as TicketListQuery["exceptionClass"]) || "ALL",
    exceptionType: (searchParams.get("exceptionType") as TicketListQuery["exceptionType"]) || "ALL",
    waybillNo: searchParams.get("waybillNo") || undefined,
    assigneeId: searchParams.get("assigneeId") || undefined,
    page: safeNumber(searchParams.get("page"), 1),
    pageSize: safeNumber(searchParams.get("pageSize"), 12)
  };
  const data = await readState((state) => listTicketsFromState(state, query));
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await createManualTicket({
      waybillNo: body.waybillNo,
      exceptionType: body.exceptionType,
      amountCents: safeNumber(body.amountCents),
      description: body.description,
      reporterId: body.reporterId
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
