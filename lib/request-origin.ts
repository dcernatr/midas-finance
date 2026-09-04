// Browser mutations must originate from MIDAS. Requests without Origin remain
// usable by non-browser clients, but still require server-verified authentication.
export function rejectForeignOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Origen de solicitud no autorizado." }, { status: 403 });
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Origen de solicitud no autorizado." }, { status: 403 });
  return null;
}
