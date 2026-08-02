FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node data/commercial-source-registry.json ./data/commercial-source-registry.json
COPY --chown=node:node DATA-LICENSES.md ./DATA-LICENSES.md

RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node

EXPOSE 7474

CMD ["node", "dist/src/main.js"]
