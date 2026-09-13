# MedScribe AI

Escriba médico para consultorio. Graba o sube el audio de una consulta, lo
transcribe, lo estructura con IA en una plantilla clínica (SOAP, Evolución,
Informe de estudios, Receta) y deja el texto plano listo para pegar en
cualquier historia clínica electrónica con un toque. Interfaz en español,
pensada para móvil y para hacer el mínimo de clics.

## Arquitectura

Un único servicio: Express sirve la API bajo `/api` y también el bundle de
Vite ya compilado, así que no hay CORS ni URLs de API que configurar.

```
artifacts/
  api-server/   Express 5 — transcripción, estructuración, CRUD de consultas
  medscribe/    React + Vite + Tailwind, hooks generados desde el spec
lib/
  api-spec/         contrato OpenAPI + configuración de orval
  api-zod/          esquemas Zod generados (validación del servidor)
  api-client-react/ hooks de TanStack Query generados (cliente)
  openai/           cliente de OpenAI y utilidades de audio (ffmpeg)
supabase/
  migrations/   esquema, RLS y bucket de audio
```

- **IA**: `gpt-4o-mini-transcribe` para voz a texto, `gpt-4o` con salida JSON
  para estructurar. Ambos configurables por variable de entorno.
- **Datos**: Supabase Postgres (consultas, preferencias) y Supabase Storage
  (grabaciones, bucket privado).
- **Auth**: Supabase Auth con email y contraseña. Toda la app está detrás del
  login; no hay modo anónimo.

## Privacidad y seguridad

Esta app guarda datos de salud, así que el aislamiento entre profesionales no
depende del código de aplicación:

- **RLS forzada** en `profiles` y `consultations`: cada política compara
  `user_id` contra `auth.uid()`. Un error en una consulta SQL igual no puede
  leer las filas de otro médico.
- **El servidor nunca usa la clave `service_role`.** Actúa con el token del
  médico que hizo el pedido, así que Postgres es la última línea de defensa.
- **Bucket privado**: las grabaciones se guardan bajo `<user_id>/…` y las
  políticas de storage verifican ese primer segmento. La única forma de
  escucharlas es una URL firmada de 5 minutos que la API emite para su dueño.
- **Anonimizador local**: reemplaza nombres, DNI, teléfonos, emails y
  direcciones por iniciales y marcadores *antes* de la llamada a la IA, de modo
  que los identificadores nunca llegan al modelo. Es heurístico (regex), no un
  sustituto de revisar el texto.
- El audio no toca el disco del servidor: vive en memoria durante el pedido y
  va directo al bucket, o se descarta.
- Borrar una consulta borra también su grabación.

## Desarrollo local

Requisitos: Node 22+, pnpm 10, `ffmpeg` en el PATH.

```bash
pnpm install
cp .env.example .env      # completá OPENAI_API_KEY y las claves de Supabase
pnpm dev                  # API en :8080, frontend en :5173 con proxy a /api
```

El frontend obtiene la configuración de Supabase de `GET /api/config` en
tiempo de ejecución, así que no hace falta ninguna variable `VITE_*`.

### Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm typecheck` | Typecheck de todos los paquetes |
| `pnpm build` | Typecheck y compilación de API y frontend |
| `pnpm codegen` | Regenera hooks y esquemas Zod desde `openapi.yaml` |
| `pnpm start` | Corre el servidor ya compilado (sirve API + frontend) |

Después de editar `lib/api-spec/openapi.yaml`, corré `pnpm codegen` antes de
tocar las rutas o el frontend. Los imports del cliente van siempre desde
`@workspace/api-client-react`, nunca desde rutas profundas a `src/generated`.

## Base de datos

Las migraciones de `supabase/migrations/` son la fuente de verdad del esquema.
Aplicalas con la CLI de Supabase:

```bash
supabase link --project-ref <ref>
supabase db push
```

Tablas: `profiles` (nombre y preferencias de estilo, sin datos clínicos) y
`consultations` (la nota estructurada, su transcripción y el puntero al audio).
Un trigger en `auth.users` crea el perfil al registrarse.

## Despliegue en Render

`render.yaml` describe un único servicio web Docker. La imagen usa Docker en
vez del runtime nativo de Node porque la ruta de transcripción invoca `ffmpeg`
para convertir grabaciones webm/m4a/ogg a WAV.

Variables de entorno a cargar en Render (las secretas están marcadas
`sync: false` en el blueprint, así que Render las pide al aplicarlo):

| Variable | Para qué |
| --- | --- |
| `OPENAI_API_KEY` | Transcripción y estructuración |
| `SUPABASE_URL` | URL del proyecto |
| `SUPABASE_PUBLISHABLE_KEY` | Clave publishable (anon); se expone al navegador vía `/api/config` |

Opcionales: `OPENAI_BASE_URL`, `OPENAI_TRANSCRIBE_MODEL`,
`OPENAI_STRUCTURE_MODEL`, `CORS_ORIGINS`, `LOG_LEVEL`, `STATIC_DIR`,
`FFMPEG_PATH`.

El health check apunta a `/api/healthz`.

## Aviso

MedScribe AI asiste en la redacción; no diagnostica ni valida contenido
clínico. La nota generada debe ser revisada por el profesional antes de
incorporarla a la historia clínica.
