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
  openai/           cliente de IA (OpenAI/Gemini) y utilidades de audio (ffmpeg)
supabase/
  migrations/   esquema, RLS y bucket de audio
```

- **IA**: OpenAI o Gemini, según `AI_PROVIDER`. Gemini expone una API
  compatible con OpenAI, así que un solo cliente sirve para los dos; la
  compatibilidad no llega a `/audio/transcriptions`, por eso la transcripción
  manda el audio como `input_audio` dentro de `/chat/completions` cuando el
  proveedor es Gemini. Los modelos son configurables.
- **Datos**: Supabase Postgres (consultas, preferencias) y Supabase Storage
  (grabaciones, bucket privado).
- **Auth**: Supabase Auth con email y contraseña. Toda la app está detrás del
  login; no hay modo anónimo.

## Grabación de la consulta

La entrada puede ser un dictado del profesional o la grabación de la consulta
entera. Para el segundo caso, la transcripción pide turnos etiquetados
("Médico:", "Paciente:", "Acompañante:") y el prompt de estructuración usa esa
atribución: lo que relata el paciente va a la anamnesis como referido, y solo
lo que afirma el médico puede volverse hallazgo, diagnóstico o indicación. Sin
eso, un "para mí es la vesícula" del paciente termina escrito como impresión
diagnóstica.

Dos límites que conviene tener presentes:

- **El examen físico es mudo.** Lo que no se verbaliza no llega al modelo. El
  prompt le prohíbe inferir hallazgos o signos vitales que no se dijeron, así
  que las secciones van a quedar incompletas si no se dictan en voz alta.
- **Las etiquetas de hablante son deducidas, no oídas.** La transcripción
  vuelve sin separar voces, así que un segundo paso asigna cada intervención
  por contenido ("respirá profundo" es el médico). Acierta casi siempre en una
  consulta, pero puede equivocarse: conviene revisar Subjetivo antes de dar la
  nota por buena.
- La separación acústica real existe en el endpoint `/v1beta/interactions` de
  Gemini, pero su respuesta es un trabajo asincrónico (`status`, `steps`) que
  hay que ir consultando hasta que termine. Intentarlo como una sola llamada
  colgaba el pedido. Queda pendiente.

## Modo recorrida: las notas se arman solas

Por defecto, al terminar de grabar la grabación entra en una **cola** y el
micrófono queda libre en el acto: la transcripción, la redacción y el guardado
siguen por atrás mientras se graba al paciente siguiente. Una franja arriba
muestra cuántas hay en proceso, cuáles quedaron listas y cuál falló, con
reintento por ítem.

Esperar la transcripción parado al lado de cada cama era la mayor parte de la
visita. Ese era el pedido, y de ahí salen las decisiones:

- **La cola es serial, no paralela.** El cuello de botella real es la cuota del
  proveedor de IA: mandar cuatro notas a la vez es cómo una recorrida se
  convierte en cuatro errores de cuota.
- **El paciente y la plantilla se congelan al frenar la grabación.** Cuando el
  trabajo corre, el médico ya está en la cama siguiente con otro paciente
  seleccionado; leer la selección en ese momento archivaría la nota en la
  persona equivocada.
- **Una grabación en cola existe solo en esa pestaña.** Todavía no se subió, así
  que cerrarla pierde el encuentro sin forma de recuperarlo: el navegador avisa
  antes de cerrar si queda algo en vuelo.

El interruptor **Modo recorrida** lo apaga. Apagado vuelve el comportamiento
anterior: la transcripción cae en el cuadro de texto para revisarla y recién
después se estructura. Es el modo para una consulta donde se quiere leer el
texto antes de que la IA lo redacte.

## Pacientes internados

Además de la consulta suelta, la app sigue pacientes a lo largo de varios días.
Se agrega un paciente, se lo selecciona, y cada nota que se graba se suma a su
línea de tiempo. **Dar de alta** lo saca de la lista de internados sin borrar
nada; borrarlo sí elimina sus notas y grabaciones.

La identidad es deliberadamente mínima: iniciales y cama. El límite de 16
caracteres en las iniciales está en la base (`check` sobre la columna), no solo
en el formulario, así que un nombre completo no entra. La identificación formal
vive en la historia clínica del hospital, que es donde corresponde.

### La ficha, y por qué la lee la IA

Cada paciente tiene además edad, sexo, peso, motivo de internación, diagnóstico
principal, antecedentes, alergias y medicación habitual. **Esos datos viajan al
modelo como antecedente en cada nota que se escribe sobre ese paciente**, y ese
es el punto: nadie dicta en voz alta "paciente de 72 años, alérgico a
penicilina" el cuarto día de internación, porque ya se sabe — y justamente por
eso no llegaba a la nota.

El prompt marca el límite con claridad, porque es donde esto se puede volver
peligroso: la ficha es antecedente, **nunca hallazgo de hoy**. Nada de lo que
está cargado ahí puede escribirse como examen físico, signo vital ni evolución
del día; eso sigue saliendo únicamente de lo que se dijo en el encuentro. Si lo
dicho contradice la ficha, para hoy vale lo dicho.

Dos decisiones de diseño:

- **Edad en años, no fecha de nacimiento.** Es lo que la nota efectivamente
  dice, y una fecha de nacimiento junto con iniciales y sala identifica a una
  persona con demasiada precisión.
- **Las alergias se muestran siempre**, en rojo, en la barra del paciente y como
  triángulo en la lista. Es el único dato cuyo costo de estar fuera de la vista
  se mide en daño.

Dos detalles que parecen menores y no lo son:

- `admitted_on` es una fecha sin hora y viaja como texto `YYYY-MM-DD`. Como
  timestamp se convertiría en medianoche UTC, que al oeste de Greenwich se
  muestra como el día anterior.
- Con un paciente seleccionado no se ofrece "borrar el historial": ese endpoint
  limpia la cuenta entera, y el botón al lado de "Visitas de J.P." se leería
  como que borra solo las de ese paciente. Para borrar varias notas de una vez
  está el selector del historial ("Seleccionar"), que manda los ids elegidos en
  un solo pedido en lugar de uno por nota.

## Errores y mejoras

Hay un tablero compartido dentro de la app (panel de ajustes → "Errores y
mejoras"): cualquiera reporta un error o pide una mejora, y el ítem lleva un
estado — pendiente, en curso, resuelto, descartado — que cualquiera puede mover
cuando algo se aplica.

Es la única tabla del sistema que **no** es privada por usuario, y es a
propósito: un bug que ya reportó otro conviene verlo antes de reportarlo de
nuevo. Lo que hace que eso sea seguro es que no contiene datos de pacientes, y
el formulario lo dice. El aislamiento fino lo resuelven los permisos, no el
código de la aplicación:

- Cualquier autenticado **lee** todo el tablero y puede **cambiar el estado** de
  cualquier ítem.
- Nadie puede reescribir el texto de un reporte ajeno: RLS no sabe hablar de
  columnas, así que eso lo hace un permiso de columna
  (`grant update (status)`), no una comprobación en la ruta.
- Cada uno borra solo lo suyo.
- `resolved_at` lo completa un trigger, para que marcar algo como resuelto no
  requiera permiso de escritura sobre una fecha.

Se guarda también el navegador y el tamaño de pantalla de quien reporta: "se ve
mal en mi celular" no se puede reproducir sin saber en qué celular.

## En el celular

La app se usa parada al lado de una cama, con una mano. Lo que eso obligó a
cambiar, medido en un navegador real a 320, 360 y 390 px de ancho:

- **Grabando, la barra inferior es solo para grabar.** Antes compartía la fila
  con "Estructurar" y necesitaba 385 px en 328 disponibles: el botón de pausa
  quedaba en x = -41, literalmente fuera de la pantalla. Como "Estructurar" está
  deshabilitado mientras se graba, no se pierde nada al sacarlo de esa fila.
- **La nota generada se trae sola a la vista.** En el teléfono se dibuja arriba
  del cuadro de entrada, así que al terminar quedaba fuera de pantalla y la app
  parecía no haber hecho nada.
- **Campos de 16 px.** iOS hace zoom sobre toda la página cuando el campo
  enfocado mide menos, que era la razón por la que el viewport tenía
  `maximum-scale=1` y no se podía hacer zoom con los dedos. Con los campos a 16
  px se pudo devolver el zoom.
- `viewport-fit=cover` más `env(safe-area-inset-bottom)`, porque la barra de
  abajo vive donde está el indicador de inicio del iPhone. La clase `pb-safe` ya
  estaba puesta en esa barra pero nunca había sido definida: no hacía nada.
- Los diálogos nuevos (ficha del paciente, tablero de reportes) son diálogo en
  escritorio y panel deslizable desde abajo en el teléfono: un diálogo centrado
  pelea con el teclado y deja su botón de cerrar lejos del pulgar.
- Los avisos emergentes suben por encima de la barra de acción. Abajo a la
  derecha, que es donde caen por defecto, quedaban justo sobre el botón de
  grabar y se comían el toque que empieza la grabación siguiente — medido, no
  supuesto. Llevarlos arriba habría tapado el nombre del paciente y la línea de
  alergias, así que quedaron abajo pero levantados.

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
- **El audio sí llega completo al proveedor de IA**, y el anonimizador no puede
  hacer nada con él: los nombres se escuchan. Tenelo en cuenta al elegir
  proveedor y plan — el tier gratuito de la API de Gemini permite que Google
  use el contenido para mejorar sus productos, cosa que el tier pago y la API
  de OpenAI no hacen.
- Borrar una consulta borra también su grabación.
- **Grabar al paciente requiere su consentimiento.** La app todavía no lo pide
  ni lo deja asentado; en Argentina son datos sensibles de salud (leyes 25.326
  y 26.529). Pendiente.

## Desarrollo local

Requisitos: Node 22+, pnpm 10, `ffmpeg` en el PATH.

```bash
pnpm install
cp .env.example .env      # completá AI_API_KEY y las claves de Supabase
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

Tablas: `profiles` (nombre y preferencias de estilo, sin datos clínicos),
`patients` (iniciales, cama, ficha clínica y fecha de alta), `feedback` (el
tablero compartido de errores y mejoras) y `consultations` (la nota
estructurada, su transcripción, el puntero al audio y el paciente al que
pertenece, si pertenece a alguno). Un trigger en `auth.users` crea el perfil al
registrarse. Borrar un paciente cascadea a sus notas, y la API borra además sus
grabaciones, que viven fuera de Postgres y no cascadean solas.

## Despliegue en Render

`render.yaml` describe un único servicio web Docker. La imagen usa Docker en
vez del runtime nativo de Node porque la ruta de transcripción invoca `ffmpeg`
para convertir grabaciones webm/m4a/ogg a WAV.

Variables de entorno a cargar en Render (las secretas están marcadas
`sync: false` en el blueprint, así que Render las pide al aplicarlo):

| Variable | Para qué |
| --- | --- |
| `AI_PROVIDER` | `openai` o `gemini` |
| `AI_API_KEY` | Clave del proveedor elegido |
| `SUPABASE_URL` | URL del proyecto |
| `SUPABASE_PUBLISHABLE_KEY` | Clave publishable (anon); se expone al navegador vía `/api/config` |

Opcionales: `AI_BASE_URL`, `AI_TRANSCRIBE_MODEL`, `AI_STRUCTURE_MODEL`,
`CORS_ORIGINS`, `LOG_LEVEL`, `STATIC_DIR`, `FFMPEG_PATH`.

Modelos por defecto: con `openai`, `gpt-4o-mini-transcribe` y `gpt-4o`; con
`gemini`, `gemini-3.5-transcribe` para transcribir y `gemini-3.5-flash` para
estructurar.

La transcripción usa el modelo dedicado a propósito: probados contra la API
real con medio segundo de silencio, los modelos flash genéricos inventaron
habla ("Hola, buenos días."), que en una nota clínica es un hallazgo
fabricado. `gemini-3.5-transcribe` devolvió vacío, que es lo correcto. Si
cambiás `AI_TRANSCRIBE_MODEL`, verificá ese comportamiento antes.

`AI_DIAGNOSTICS=1` hace que el servidor, al arrancar, liste los modelos que la
clave alcanza y pruebe con cada candidato una llamada de chat y una de audio,
dejando el resultado en los logs. Sirve porque un modelo o una modalidad no
soportada vuelve como un 404 sin cuerpo, sin decir qué nombre esperaba.
**Consume cuota**: son unas nueve llamadas por arranque, y con varios deploys
seguidos alcanza para agotar el plan gratuito de Gemini. Encendelo para
diagnosticar y apagalo enseguida.

Cada transcripción cuesta dos llamadas: una para transcribir y otra para
etiquetar los hablantes. Transcribir con `gemini-3.5-flash` en vez del modelo
dedicado concentra las tres tareas (transcribir, etiquetar y estructurar) en
una sola cuota y la agota tres veces más rápido; el modelo dedicado tiene la
suya aparte.

El health check apunta a `/api/healthz`.

## Aviso

MedScribe AI asiste en la redacción; no diagnostica ni valida contenido
clínico. La nota generada debe ser revisada por el profesional antes de
incorporarla a la historia clínica.
