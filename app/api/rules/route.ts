import { NextResponse } from "next/server";
import { readState, writeState } from "@/lib/store";
import { nowIso, safeNumber } from "@/lib/utils";

export async function GET() {
  const data = await readState((state) => ({
    qualityRules: state.qualityRules,
    approvalRules: state.approvalRules,
    settings: state.settings
  }));
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const data = await writeState((state) => {
    if (body.qualityRules) {
      state.qualityRules = body.qualityRules.map((item: any) => ({
        ...item,
        threshold:
          item.field === "labelReadable"
            ? item.threshold === true || item.threshold === "true"
            : safeNumber(item.threshold),
        targetApprovalLevel: safeNumber(item.targetApprovalLevel, 1),
        updatedAt: nowIso()
      }));
    }
    if (body.approvalRules) {
      state.approvalRules = body.approvalRules.map((item: any) => ({
        ...item,
        minAmountCents: safeNumber(item.minAmountCents),
        maxAmountCents: item.maxAmountCents === "" || item.maxAmountCents === undefined ? undefined : safeNumber(item.maxAmountCents),
        timeoutHours: safeNumber(item.timeoutHours, 8),
        requiredLevel: safeNumber(item.requiredLevel, 1)
      }));
    }
    if (body.settings) {
      state.settings = {
        ...state.settings,
        ...body.settings,
        maxResubmitCount: safeNumber(body.settings.maxResubmitCount, state.settings.maxResubmitCount),
        qcHoldTimeoutMinutes: safeNumber(body.settings.qcHoldTimeoutMinutes, state.settings.qcHoldTimeoutMinutes)
      };
    }
    return {
      qualityRules: state.qualityRules,
      approvalRules: state.approvalRules,
      settings: state.settings
    };
  });
  return NextResponse.json(data);
}
