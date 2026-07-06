import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const allowedDocs = new Set(["assumptions.md", "api-contract.md"]);

export async function GET(_request: Request, context: { params: Promise<{ doc: string }> }) {
  const { doc } = await context.params;
  if (!allowedDocs.has(doc)) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const filePath = path.join(process.cwd(), "docs", doc);
  const content = await readFile(filePath, "utf8");
  return new NextResponse(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8"
    }
  });
}
