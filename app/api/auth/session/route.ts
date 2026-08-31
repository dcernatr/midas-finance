import { ID } from "node-appwrite";
import { cookies } from "next/headers";
import { appwriteSessionCookieName, createAdminServices } from "../../../../lib/appwrite/server";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const mode = String(payload.mode ?? "signin");
    if (!email || password.length < 8) {
      return Response.json({ error: "Ingresa un correo válido y una contraseña de al menos 8 caracteres." }, { status: 400 });
    }

    const { account } = createAdminServices();
    if (mode === "signup") {
      await account.create({
        userId: ID.unique(),
        email,
        password,
        name: email.split("@")[0],
      });
    } else if (mode !== "signin") {
      return Response.json({ error: "Acción de acceso inválida." }, { status: 400 });
    }

    const session = await account.createEmailPasswordSession({ email, password });
    const cookieStore = await cookies();
    cookieStore.set(appwriteSessionCookieName(), session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      expires: new Date(session.expire),
    });
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar el acceso.";
    return Response.json({ error: message }, { status: 400 });
  }
}
