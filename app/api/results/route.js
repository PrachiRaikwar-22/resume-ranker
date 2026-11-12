import { NextResponse } from "next/server";
import { getCandidates, JDS } from "../../../lib/data";
import { scoreAll } from "../../../lib/score";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(scoreAll(getCandidates(), JDS));
}