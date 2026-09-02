# MIDAS Finance

MIDAS (Money Intelligence, Debt, Allocation & Spending) es un hub de control de gastos construido con Next.js y Appwrite Cloud.

## Funciones principales

- Dashboard de ejecución mensual, forecast y MIDAS Score.
- Gastos programados con categorías, grupos, tipos, presupuestos y colores editables.
- Gastos efectivos manuales o importados desde Google Sheets.
- Importación append-only con detección por archivo, pestaña y contenido, vista previa y cinco campos de mapeo.
- Códigos automáticos `AA-MM-G/I-000` para movimientos manuales e importados.
- Gestión y proyección de deudas.
- HELP buscable y ADMIN protegido por rol.
- Aislamiento de datos por usuario desde el servidor y tablas privadas.
- Infraestructura propia, sin compartir base de datos con TERRAN ni PomoBoxing.

## Stack

- Next.js 16 + React 19 + TypeScript
- Appwrite Auth + TablesDB
- Tailwind CSS + componentes shadcn
- Appwrite Sites

## Desarrollo local

1. Crea un proyecto exclusivo para MIDAS en Appwrite Cloud y elige la region **New York (`nyc`)** para reducir la latencia desde Peru frente a Europa.
2. Copia `.env.example` a `.env.local` y completa:

   - `NEXT_PUBLIC_APPWRITE_ENDPOINT`
   - `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
   - `APPWRITE_API_KEY`
   - `APPWRITE_DATABASE_ID=midas`

3. Crea una API key de servidor con estos scopes:

   - `sessions.write`
   - `databases.read`, `databases.write`
   - `tables.read`, `tables.write`
   - `columns.read`, `columns.write`
   - `indexes.read`, `indexes.write`
   - `rows.read`, `rows.write`

4. Instala, prepara Appwrite y ejecuta:

   ```bash
   npm install
   npm run appwrite:setup
   npm run dev
   ```

5. Abre `http://localhost:3000`.

## Base de datos

`scripts/setup-appwrite.mjs` crea una base independiente y diez tablas privadas `midas_*`, incluida la secuencia de códigos. El navegador no recibe la API key ni accede directamente a las tablas. Las rutas Next.js validan la sesión y fuerzan el `user_id` en cada operación. El primer usuario registrado recibe el rol ADMIN.

### Actualización de una instalación existente (antes de desplegar)

El sitio Appwrite ya vinculado a MIDAS ejecuta esta migración automáticamente mediante `prebuild`, utilizando la credencial de servidor que ya tiene configurada. Se verifica el sitio, proyecto, región y base de datos antes de acceder a los datos. Si la configuración o la migración falla, se detiene la compilación. Las compilaciones locales/CI sin `APPWRITE_SITE_ID` no modifican ninguna base. No es necesario copiar ni revelar credenciales.

Referencia de las variables inyectadas por el proveedor: https://appwrite.io/docs/products/sites/environment-variables

Con las variables de servidor ya configuradas para **el proyecto MIDAS**, ejecuta:

```bash
npm run appwrite:migrate-ledger
```

La migración es aditiva e idempotente: agrega `midas_transactions.midas_code` y `midas_transaction_sequences`, sin borrar movimientos ni modificar otros proyectos. Requiere los permisos de tablas, columnas e índices indicados arriba. **No desplegar esta versión antes de que termine correctamente.** Al cargar los datos después del despliegue, los movimientos anteriores sin código reciben uno; los que ya lo tienen lo conservan.

La numeración es independiente por usuario, año-mes y tipo (G/I), compartida entre registros manuales e importados. El incremento y la escritura se confirman en una transacción de Appwrite. Los números eliminados no se reutilizan. Cambiar el mes o tipo de un movimiento asigna un código del nuevo período/tipo. Más de 999 movimientos continúa en 1000, sin truncarse.

## Google Sheets

MIDAS no usa Google API, OAuth ni credenciales. Acepta enlaces `/edit`, `drivesdk`, publicados o exportables. La hoja debe tener:

`Compartir → Acceso general → Cualquier persona con el enlace → Lector`

Al conectar el archivo, MIDAS detecta sus pestañas visibles y permite seleccionar cuál se importará y sincronizará.

Los únicos campos que se mapean son:

`Fecha | Nombre | Ingreso | Gasto | Categoría`

Fecha, Nombre y Categoría son obligatorios; basta con una de las columnas Ingreso o Gasto. Cada fila debe contener un único importe no nulo. Si Categoría dice **Ingreso** o **Ingresos** (sin distinguir mayúsculas ni acentos), MIDAS registra un ingreso con el valor absoluto del importe, incluso si está en Gasto. No hay selector adicional. Para las demás categorías, la columna Ingreso registra ingresos y Gasto registra gastos, independientemente del signo de este último. Se reconocen fechas `DD/MM/AA` e importes con `S/` o `S/.`.

La importación se procesa por lotes de hasta ocho filas, con progreso y un punto de continuación guardado en cada lote. Ante una interrupción temporal, MIDAS reintenta con el mismo identificador y conserva los movimientos ya guardados. Si cambia la hoja o el mapeo durante el proceso, pide reiniciar sin borrar datos. Las respuestas XML/HTML de error no se interpretan como JSON ni CSV; se muestra un mensaje legible. La configuración de fuentes y los movimientos manuales no se reenvían automáticamente.

No se solicita ni importa un ID de la hoja: MIDAS genera el código. Las conexiones antiguas con `ID_MOVIMIENTO` deben volver a mapear sus columnas antes de sincronizar.

La sincronización conserva ambos orígenes en Gastos Efectivos y en el CSV (cinco campos más código, origen y fuente). Los duplicados se comparan dentro del mismo archivo y pestaña; los registros manuales no se descartan por coincidir con una hoja. Reordenar filas no crea duplicados. Filas idénticas repetidas en una pestaña mantienen su multiplicidad. Sin un identificador externo estable, **editar el contenido de una fila en la hoja se considera un movimiento nuevo**. Cambiar el nombre de la pestaña también cambia el ámbito de la fuente. Las importaciones antiguas solo se reconocen automáticamente cuando su fuente guardada identifica inequívocamente la misma pestaña.

## Comandos

```bash
npm run dev
npm run lint
npm run build
npm test
npm run appwrite:setup
npm run appwrite:migrate-ledger
```

## Despliegue en Appwrite Sites

En Appwrite, abre **Sites → Create site → Connect Git repository**, selecciona este repositorio y usa:

- Framework: Next.js
- Install Command: `npm install`
- Build Command: `npm run build`
- Output: `.next`

Agrega las cuatro variables de `.env.example`. Appwrite Sites soporta Next.js SSR directamente.
