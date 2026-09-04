import { getAuth } from "@/lib/neon-auth";
import { rejectForeignOrigin } from "@/lib/request-origin";
import { authFailureResponse } from "@/lib/auth-diagnostics";

export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  try {
    const { email } = await request.json();
    if (typeof email !== "string" || !email.includes("@")) return Response.json({ error: "Ingresa tu correo." }, { status: 400 });
    const result = await getAuth().sendVerificationEmail({ email: email.trim().toLowerCase(), callbackURL: new URL("/login", request.url).href });
    if (result.error) return authFailureResponse(result.error, "verification");
    // Same response whether the account exists or not.
    return Response.json({ message: "Si la cuenta necesita verificación, recibirás un correo. Revisa también spam." });
  } catch (error) {
    return authFailureResponse(error, "verification");
  }
}
