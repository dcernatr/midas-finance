import { pathToFileURL } from "node:url";
import { Client, TablesDB } from "node-appwrite";
import { ensureLedgerSchema } from "./ledger-schema.mjs";
import { ensureBudgetSchema } from "./budget-schema.mjs";

// Only this already-linked MIDAS deployment may run the automatic migration.
// Local and credential-free CI builds do not access a database.
export function deploymentConfig(env) {
  if (!env.APPWRITE_SITE_ID) return null;
  if (env.APPWRITE_SITE_ID !== "6a94fe3e001e18fb98ba" ||
      env.APPWRITE_SITE_PROJECT_ID !== "6a94f1000028038e283d" ||
      env.NEXT_PUBLIC_APPWRITE_PROJECT_ID !== env.APPWRITE_SITE_PROJECT_ID ||
      (env.APPWRITE_DATABASE_ID || "midas") !== "midas" ||
      env.NEXT_PUBLIC_APPWRITE_ENDPOINT !== "https://nyc.cloud.appwrite.io/v1") {
    throw new Error("El destino de la migración no coincide con el proyecto MIDAS autorizado.");
  }
  if (!env.APPWRITE_API_KEY) throw new Error("Falta la credencial de servidor de MIDAS en el entorno de compilación.");
  return { endpoint: env.NEXT_PUBLIC_APPWRITE_ENDPOINT, project: env.NEXT_PUBLIC_APPWRITE_PROJECT_ID, key: env.APPWRITE_API_KEY };
}

export async function prepareDeployment(env, migrate = async config => {
  const client = new Client().setEndpoint(config.endpoint).setProject(config.project).setKey(config.key);
  await ensureLedgerSchema(new TablesDB(client), "midas");
  await ensureBudgetSchema(new TablesDB(client), "midas");
}) {
  const config = deploymentConfig(env);
  if (!config) {
    console.log("Compilación local/CI: no se modifica ninguna base de datos.");
    return false;
  }
  await migrate(config);
  console.log("MIDAS: migración verificada; se puede compilar la nueva versión.");
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await prepareDeployment(process.env); }
  catch (error) {
    // Never print configuration, credentials or SDK request/response objects.
    console.error("Publicación detenida: no se pudo verificar la migración de MIDAS.");
    if (error?.code) console.error("Código de respuesta:", error.code);
    else console.error(error instanceof Error ? error.message : "Configuración inválida.");
    process.exitCode = 1;
  }
}
