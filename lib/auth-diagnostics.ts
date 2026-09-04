export class AuthConfigurationError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function readAuthConfiguration(env: Record<string, string | undefined>) {
  const baseUrl = env.NEON_AUTH_BASE_URL?.trim();
  const secret = env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl) throw new AuthConfigurationError("AUTH_URL_MISSING", "Falta NEON_AUTH_BASE_URL en la configuración publicada.");
  let url: URL;
  try { url = new URL(baseUrl); }
  catch { throw new AuthConfigurationError("AUTH_URL_INVALID", "La dirección de Neon Auth no es válida en la configuración publicada."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new AuthConfigurationError("AUTH_URL_INVALID", "La dirección de Neon Auth debe ser HTTPS y no contener credenciales ni parámetros.");
  if (!secret) throw new AuthConfigurationError("AUTH_SECRET_MISSING", "Falta NEON_AUTH_COOKIE_SECRET en la configuración publicada.");
  if (secret.length < 32) throw new AuthConfigurationError("AUTH_SECRET_TOO_SHORT", "NEON_AUTH_COOKIE_SECRET debe tener al menos 32 caracteres.");
  return { baseUrl, secret };
}

type AuthPhase = "configuration" | "signin" | "signup" | "verification";
export function authFailure(error: unknown, phase: AuthPhase) {
  let code = "AUTH_INTERNAL_ERROR";
  let message = "El servidor no pudo completar el acceso.";
  let status = 503;
  if (error instanceof AuthConfigurationError) {
    code = error.code;
    message = error.message;
  } else {
    const failure = error as { code?: unknown; status?: unknown } | null;
    const providerStatus = typeof failure?.status === "number" ? failure.status : 0;
    if (failure?.code === "INVALID_ORIGIN" || failure?.code === "INVALID_CALLBACK_URL") {
      code = "AUTH_DOMAIN_REJECTED";
      message = "Neon rechazó el dominio de acceso de MIDAS.";
    } else if (providerStatus === 429) {
      code = "AUTH_RATE_LIMITED";
      message = "Demasiados intentos. Espera unos minutos antes de volver a intentar.";
      status = 429;
    } else if (providerStatus >= 500) {
      code = "AUTH_PROVIDER_UNAVAILABLE";
      message = "MIDAS no pudo comunicarse correctamente con Neon Auth.";
    } else if (providerStatus >= 400) {
      code = phase === "signup" ? "AUTH_SIGNUP_REJECTED" : phase === "verification" ? "AUTH_VERIFICATION_REJECTED" : "AUTH_SIGNIN_REJECTED";
      message = phase === "signup" ? "Neon no aceptó el registro. Revisa los datos; si ya tienes cuenta, utiliza Ingresar." : phase === "verification" ? "No se pudo solicitar la verificación del correo." : "No se pudo ingresar. Revisa los datos y la verificación del correo.";
      status = 400;
    }
  }
  const requestId = crypto.randomUUID();
  // Never log provider messages, payloads, emails, passwords, URLs or secrets.
  console.error(JSON.stringify({ event: "midas.auth.failure", phase, code, status, requestId }));
  return { status, code, requestId, message: `${message} [${code}]`, phase };
}

export function authFailureResponse(error: unknown, phase: AuthPhase) {
  const failure = authFailure(error, phase);
  return Response.json({ error: failure.message, code: failure.code, requestId: failure.requestId },
    { status: failure.status, headers: { "Cache-Control": "no-store" } });
}
