import { getAuth } from "../../../../lib/neon-auth";
import { rejectForeignOrigin } from "../../../../lib/request-origin";
import { authFailure, authFailureResponse } from "../../../../lib/auth-diagnostics";

export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  let phase: "configuration" | "signin" | "signup" = "configuration";
  try {
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") return Response.json({ error: "Solicitud de acceso no válida." }, { status: 400 });
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const mode = String(payload.mode ?? "signin");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 256 || !["signin","signup"].includes(mode))
      return Response.json({ error: "Ingresa un correo válido y una contraseña de al menos 8 caracteres." }, { status: 400 });
    const auth = getAuth();
    phase = mode === "signup" ? "signup" : "signin";
    const result = mode === "signup"
      ? await auth.signUp.email({ email, password, name: email.split("@")[0] })
      : await auth.signIn.email({ email, password });
    if (result.error) return authFailureResponse(result.error, phase);
    if (mode === "signup") {
      try {
        const verification = await auth.sendVerificationEmail({ email, callbackURL: new URL("/login", request.url).href });
        if (verification.error) throw verification.error;
        return Response.json({ success: true, needsVerification: true, message: "Cuenta creada. Revisa tu correo y verifica tu cuenta antes de ingresar." });
      } catch (error) {
        const failure = authFailure(error, "verification");
        return Response.json({ success: true, needsVerification: true, code: failure.code, requestId: failure.requestId,
          message: `Cuenta creada, pero no se pudo enviar la verificación. Utiliza Reenviar verificación. [${failure.code}]` });
      }
    }
    return Response.json({ success: true });
  } catch (error) {
    return authFailureResponse(error, phase);
  }
}
