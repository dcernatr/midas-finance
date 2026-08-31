import { NextResponse, type NextRequest } from "next/server";

function sessionCookieName() {
  return `a_session_${process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || "midas"}`;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || path.startsWith("/api/auth/") || path.startsWith("/auth/");
  const hasSession = Boolean(request.cookies.get(sessionCookieName())?.value);
  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("returnTo", path);
    return NextResponse.redirect(url);
  }
  if (hasSession && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
