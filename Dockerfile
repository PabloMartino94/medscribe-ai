# MedScribe AI — one image serving both the API and the built frontend.
#
# Docker rather than Render's native Node runtime because the transcription
# route shells out to ffmpeg to convert webm/m4a/ogg recordings to WAV, and
# ffmpeg is not present in that runtime.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build

# Pinned to the version that produced pnpm-lock.yaml. Installed with npm
# rather than corepack, which is deprecated in recent Node releases.
RUN npm install --global pnpm@10.33.0

WORKDIR /app

# Manifests first: this layer only changes when dependencies do, so the install
# below stays cached across ordinary source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/api-server/package.json  artifacts/api-server/package.json
COPY artifacts/medscribe/package.json   artifacts/medscribe/package.json
COPY lib/api-client-react/package.json  lib/api-client-react/package.json
COPY lib/api-spec/package.json          lib/api-spec/package.json
COPY lib/api-zod/package.json           lib/api-zod/package.json
COPY lib/openai/package.json            lib/openai/package.json

RUN pnpm install --frozen-lockfile

COPY . .

# Typecheck runs as part of `build`, so a type error fails the image rather
# than shipping.
RUN pnpm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Only the two build outputs, in the same relative layout the server expects
# when it resolves the static directory.
COPY --from=build --chown=node:node /app/artifacts/api-server/dist  ./artifacts/api-server/dist
COPY --from=build --chown=node:node /app/artifacts/medscribe/dist   ./artifacts/medscribe/dist

USER node

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
