# syntax=docker/dockerfile:1 — закомментировано сознательно: директива заставляет
# buildkit тянуть frontend-образ с docker.io даже для сборки из кэша, а на сетях
# с нестабильным DNS/доступом к docker.io (VPN только на хосте) она роняет сборку
# на первом шаге. Весь использованный синтаксис есть во встроенном frontend.
#
# Многостадийный образ PCA (ANA-14).
#   build-стадия:  полный pnpm install + сборка @pca/frontend (Vite)
#   prod-стадия:   только --prod зависимости, бэкенд через tsx, chromium для PDF
#
# Сборка и запуск:
#   docker build -t pca .
#   docker compose up -d          # см. docker-compose.yml
#
# Если Docker-VM не имеет прямого доступа к registry.npmjs.org (типично: VPN/прокси
# только на хосте), сборку можно направить через зеркало:
#   docker build \
#     --build-arg COREPACK_NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
#     -t pca .
#
# Секреты — только через env/.env (APP_SECRET, токены Метрики). В образ они не попадают.

# Виден corepack'у при скачивании pnpm (ARG пробрасывается в RUN как env-переменная).
ARG COREPACK_NPM_REGISTRY

# --- Стадия 1: build (полные зависимости + сборка фронта) -----------------------------------
FROM node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

# Зеркало npm-реестра для pnpm install (пусто по умолчанию = официальный registry).
# COREPACK_NPM_REGISTRY — переобъявление глобального ARG: без него corepack в этой
# стадии не увидит зеркало и упадёт на скачивании pnpm.
ARG COREPACK_NPM_REGISTRY
ARG NPM_CONFIG_REGISTRY

# Сперва только манифесты и lockfile — этот слой кэшируется, пока не меняют зависимости.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# tsconfig.base.json обязателен: code/*/tsconfig.json extends ../../tsconfig.base.json;
# без него tsc собирает с дефолтами (target ES3, skipLibCheck false) и падает
# на типах из node_modules.
COPY tsconfig.base.json ./
COPY code/backend/package.json code/backend/package.json
COPY code/shared/package.json code/shared/package.json
COPY code/frontend/package.json code/frontend/package.json

# Ключи аутентификации Google Fonts не нужны в сборке, prepack скриптов нет —
# обычный полный install (frontend для сборки нужны devDependencies).
RUN pnpm install --frozen-lockfile ${NPM_CONFIG_REGISTRY:+--registry "$NPM_CONFIG_REGISTRY"}

COPY code/backend code/backend
COPY code/shared code/shared
COPY code/frontend code/frontend

WORKDIR /app/code/frontend
RUN pnpm build

# --- Стадия 2: production --------------------------------------------------------------------
FROM node:22-bookworm-slim AS prod

# Chromium — движок PDF/DOCX-рендера отчётов (puppeteer-core находит его через
# PUPPETEER_EXECUTABLE_PATH, см. ENV ниже). Шрифты — соответствуют шрифтам интерфейса.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends \
        chromium openssl ca-certificates tzdata \
        fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Chromium на Debian ставится в /usr/bin/chromium (аналог Google Chrome на проде,
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome — см. deploy/DEPLOY.md).
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production \
    HOST=0.0.0.0

# tsx — раннер бэкенда: в prod-зависимостях @pca/backend его нет.
# pnpm нужен для --prod install: в чистом node-образе шимов corepack нет на PATH,
# включаем (pnpm скачается при первом вызове; при зеркале — см. ARG ниже).
ARG COREPACK_NPM_REGISTRY
ARG NPM_CONFIG_REGISTRY
RUN corepack enable && npm install -g tsx@^4

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY code/backend/package.json code/backend/package.json
COPY code/shared/package.json code/shared/package.json

# Прод-зависимости: их в два раза меньше, чем полный install (--prod),
# но tsx остаётся глобальным (в prod deps backend его нет).
RUN pnpm install --prod --frozen-lockfile ${NPM_CONFIG_REGISTRY:+--registry "$NPM_CONFIG_REGISTRY"}

COPY code/backend/src code/backend/src
COPY code/shared/src code/shared/src
# Статьи помощи (<lang>/*.md для HELP_DIR — см. code/backend/src/help/help.ts).
COPY docs/help /app/docs/help
# Собранный фронтенд — для «однобакетного» сценария (статика отдаётся снаружи,
# например nginx/share, см. docs/deploy.md «Docker»).
COPY --from=build /app/code/frontend/dist /app/frontend-dist

ENV NODE_OPTIONS=--max-old-space-size=512

EXPOSE 4000

# tsx без кэша pnpm/graceful: SIGTERM → fastify close (см. code/backend/src/server.ts).
CMD ["tsx", "code/backend/src/server.ts"]
