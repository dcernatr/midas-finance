import { getAuth } from "../../../../lib/neon-auth";
import { rejectForeignOrigin } from "../../../../lib/request-origin";

export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const mode = String(payload.mode ?? "signin");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 256 || !["signin","signup"].includes(mode))
      return Response.json({ error: "Ingresa un correo válido y una contraseña de al menos 8 caracteres." }, { status: 400 });
    const auth = getAuth();
    const result = mode === "signup"
      ? await auth.signUp.email({ email, password, name: email.split("@")[0] })
      : await auth.signIn.email({ email, password });
    if (result.error) return Response.json({ error: "No se pudo completar el acceso. Revisa los datos y la verificación de tu correo." }, { status: 400 });
    if (mode === "signup") {
      const verification = await auth.sendVerificationEmail({ email, callbackURL: new URL("/login", request.url).href });
      return Response.json({ success: true, needsVerification: true,
        message: verification.error ? "Cuenta creada. No se pudo enviar la verificación; vuelve a intentarlo desde el botón Reenviar verificación." : "Cuenta creada. Revisa tu correo y verifica tu cuenta antes de ingresar." });
    }
    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "No se pudo completar el acceso. Comprueba la conexión e inténtalo nuevamente." }, { status: 503 });
  }
}
