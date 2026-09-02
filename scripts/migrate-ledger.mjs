import { Client, TablesDB } from "node-appwrite";
import { ensureLedgerSchema } from "./ledger-schema.mjs";
import { ensureBudgetSchema } from "./budget-schema.mjs";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const key = process.env.APPWRITE_API_KEY;
if (!endpoint || !project || !key) throw new Error("Usa las variables de entorno de MIDAS para ejecutar esta migración antes de publicar.");
const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
await ensureLedgerSchema(new TablesDB(client), process.env.APPWRITE_DATABASE_ID || "midas");
await ensureBudgetSchema(new TablesDB(client), process.env.APPWRITE_DATABASE_ID || "midas");
