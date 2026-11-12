import { NextResponse } from "next/server";
import { getCandidates, JDS } from "../../../lib/data";
import { scoreAll } from "../../../lib/score";
import { extractFromText } from "../../../lib/extract";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "File too large (max 4 MB)" }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    let text = "";
    if (/\.pdf$/i.test(file.name)) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(buf));
      const { text: t } = await extractText(doc, { mergePages: true });
      text = t;
    } else if (/\.(txt|md)$/i.test(file.name)) {
      text = buf.toString("utf8");
    } else {
      return NextResponse.json({ error: "Unsupported file type. Upload a PDF or TXT." }, { status: 400 });
    }

    const pile = getCandidates();
    const known = [...new Set([...pile.flatMap((c) => c.skills_found || []), ...JDS.flatMap((j) => j.keywords || [])])];
    const cand = extractFromText(text, file.name, known);
    const out = scoreAll([...pile, cand], JDS);
    return NextResponse.json({ ...out, new_candidate: cand.candidate_name, total: pile.length + 1 });
  } catch (e) {
    return NextResponse.json({ error: "Could not process file: " + (e.message || e) }, { status: 500 });
  }
}
