import { getAuth } from "../../../../lib/neon-auth";
import { rejectForeignOrigin } from "../../../../lib/request-origin";
import { authFailureResponse } from "../../../../lib/auth-diagnostics";

export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  let phase: "configuration" | "signin" | "signup" = "configuration";
  try {
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") return Response.json({ error: "Solicitud de acceso no válida." }, { status: 400 });
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const mode = String(payload.mode ?? "magiclink");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["signin","signup","magiclink"].includes(mode))
      return Response.json({ error: "Ingresa un correo válido." }, { status: 400 });
    if (mode === "signin" && (password.length < 8 || password.length > 256))
      return Response.json({ error: "Ingresa una contraseña de al menos 8 caracteres." }, { status: 400 });
    const auth = getAuth();
    phase = mode === "signup" ? "signup" : "signin";
    if (mode === "signup" || mode === "magiclink") {
      const result = await auth.signIn.magicLink({ email, callbackURL: new URL("/", request.url).href });
      if (result.error) return authFailureResponse(result.error, mode === "signup" ? "signup" : "signin");
      return Response.json({ success: true, needsVerification: true,
        message: mode === "magiclink"
          ? "Enlace enviado. Ábrelo desde tu correo para verificar tu cuenta y entrar a MIDAS."
          : "Enlace enviado. Ábrelo desde tu correo para crear la cuenta y entrar a MIDAS." });
    }
    const result = await auth.signIn.email({ email, password });
    if (result.error) return authFailureResponse(result.error, phase);
    return Response.json({ success: true });
  } catch (error) {
    return authFailureResponse(error, phase);
  }
}
