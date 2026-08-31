import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appwriteSessionCookieName, createSessionAccount } from "@/lib/appwrite/server";

export async function POST(request: Request) {
  const account = await createSessionAccount();
  try {
    await account?.deleteSession({ sessionId: "current" });
  } catch {
    // A stale session is still safely removed from the browser below.
  }
  (await cookies()).delete(appwriteSessionCookieName());
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
