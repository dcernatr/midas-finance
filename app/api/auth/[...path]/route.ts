import { getAuth } from "@/lib/neon-auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export function GET(request: Request, context: Context) { return getAuth().handler().GET(request, context); }
export function POST(request: Request, context: Context) { return getAuth().handler().POST(request, context); }
