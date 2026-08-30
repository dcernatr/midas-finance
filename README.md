# MIDAS Finance

MIDAS (Money Intelligence, Debt, Allocation & Spending) es un centro de control financiero personal construido con Next.js, Supabase y PostgreSQL.

## Funciones principales

- Dashboard de ejecución mensual, forecast y MIDAS Score.
- Gastos programados con categorías, grupos, tipos, presupuestos y colores editables.
- Gastos efectivos manuales o importados desde Google Sheets.
- Importación append-only con detección por `ID_MOVIMIENTO`, vista previa y mapeo de columnas.
- Gestión y proyección de deudas.
- HELP buscable y ADMIN protegido por rol.
- Aislamiento de datos por usuario y políticas RLS.
- Convivencia segura con TERRAN mediante tablas exclusivas con prefijo `midas_*`.

## Stack

- Next.js 16 + React 19 + TypeScript
- Supabase Auth + Data API + PostgreSQL
- Drizzle ORM
- Tailwind CSS + componentes shadcn
- Vercel

## Desarrollo local

1. Copia `.env.example` a `.env.local`.
2. Completa:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

3. Instala y ejecuta:

   ```bash
   npm install
   npm run dev
   ```

4. Abre `http://localhost:3000`.

## Base de datos

La migración inicial está en:

`supabase/migrations/20260830174317_initial_midas_shared_terran.sql`

Incluye nueve tablas `midas_*`, claves foráneas, índices, restricciones, permisos mínimos y RLS. Cada tabla expuesta queda protegida por `auth.uid()`; la autorización ADMIN usa `midas_private.is_admin()` con `search_path` fijado. Las rutas del servidor usan la Data API con la sesión del usuario y no requieren una contraseña de PostgreSQL. Las migraciones no contienen operaciones globales sobre `public`, por lo que no modifican tablas, políticas ni permisos de TERRAN.

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
npm run db:generate
```

## Despliegue en Vercel

Conecta el repositorio a Vercel, vincula el proyecto Supabase e incorpora las variables indicadas en `.env.example`. El Build Command es `npm run build`.
