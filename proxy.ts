import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "./lib/neon-auth";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/login" || path.startsWith("/api/") || path.startsWith("/auth/")) return NextResponse.next();
  try { return await getAuth().middleware({ loginUrl: "/login" })(request); }
  catch { return NextResponse.redirect(new URL("/login", request.url)); }
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
