# MIDAS Finance

MIDAS (Money Intelligence, Debt, Allocation & Spending) es un centro de control financiero personal construido con Next.js y Appwrite Cloud.

## Funciones principales

- Dashboard de ejecución mensual, forecast y MIDAS Score.
- Gastos programados con categorías, grupos, tipos, presupuestos y colores editables.
- Gastos efectivos manuales o importados desde Google Sheets.
- Importación append-only con detección por `ID_MOVIMIENTO`, vista previa y mapeo de columnas.
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

`scripts/setup-appwrite.mjs` crea una base independiente y nueve tablas privadas `midas_*`. El navegador no recibe la API key ni accede directamente a las tablas. Las rutas Next.js validan la sesión y fuerzan el `user_id` en cada operación. El primer usuario registrado recibe el rol ADMIN.

## Google Sheets

MIDAS no usa Google API, OAuth ni credenciales. Acepta enlaces `/edit`, `drivesdk`, publicados o exportables. La hoja debe tener:

`Compartir → Acceso general → Cualquier persona con el enlace → Lector`

Columnas mínimas:

`ID_MOVIMIENTO | Fecha | Descripción | Monto`

Columnas opcionales:

`Categoría | Subcategoría | Medio_Pago | Cuenta | Nota`

## Comandos

```bash
npm run dev
npm run lint
npm run build
npm test
npm run appwrite:setup
```

## Despliegue en Appwrite Sites

En Appwrite, abre **Sites → Create site → Connect Git repository**, selecciona este repositorio y usa:

- Framework: Next.js
- Install Command: `npm install`
- Build Command: `npm run build`
- Output: `.next`

Agrega las cuatro variables de `.env.example`. Appwrite Sites soporta Next.js SSR directamente.
