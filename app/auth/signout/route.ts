import { NextResponse } from "next/server";
import { getAuth } from "@/lib/neon-auth";
import { rejectForeignOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  try {
    const { error } = await getAuth().signOut();
    if (error) return Response.json({ error: "No se pudo cerrar la sesión. Vuelve a intentar." }, { status: 503 });
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  } catch {
    return Response.json({ error: "No se pudo cerrar la sesión. Vuelve a intentar." }, { status: 503 });
  }
}
