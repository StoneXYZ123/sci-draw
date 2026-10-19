import { NextResponse } from "next/server";

export function jsonNoStore(body: unknown, status = 200, extraHeaders?: HeadersInit): NextResponse {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { status, headers });
}
