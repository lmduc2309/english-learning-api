FROM node:20-alpine AS dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM dependencies AS build

COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM build AS production-dependencies
RUN npm prune --omit=dev

# One-shot operational image. It keeps ts-node and the source scripts, and adds
# PostgreSQL clients; it is never the long-running application container.
FROM dependencies AS operations

RUN apk add --no-cache postgresql-client zsh
COPY nest-cli.json tsconfig*.json jest.scripts.config.js ./
COPY scripts ./scripts
# DSD operational scripts deliberately share the production data-source,
# migration, quality, similarity, release-audit, and content-hash code. Keep
# that single implementation in the operations image instead of allowing a
# container-only copy to drift from the serving path.
COPY src/dsd-corpus ./src/dsd-corpus
COPY data/dsd/source-registry.json ./data/dsd/source-registry.json
COPY data/dsd/tool-registry.json ./data/dsd/tool-registry.json
COPY data/dsd/contributor-registry.json ./data/dsd/contributor-registry.json
COPY data/dsd/similarity ./data/dsd/similarity
COPY data/dsd/release-public-keys.json ./data/dsd/release-public-keys.json
COPY data/dsd/tools ./data/dsd/tools

CMD ["npm", "run", "dsd:verify-restores"]

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node data/commercial-source-registry.json ./data/commercial-source-registry.json
COPY --chown=node:node data/dsd/source-registry.json ./data/dsd/source-registry.json
COPY --chown=node:node data/dsd/tool-registry.json ./data/dsd/tool-registry.json
COPY --chown=node:node data/dsd/contributor-registry.json ./data/dsd/contributor-registry.json
COPY --chown=node:node data/dsd/similarity ./data/dsd/similarity
COPY --chown=node:node data/dsd/release-public-keys.json ./data/dsd/release-public-keys.json
COPY --chown=node:node data/dsd/tools ./data/dsd/tools
COPY --chown=node:node DATA-LICENSES.md ./DATA-LICENSES.md

RUN mkdir -p /app/uploads /app/data/dsd/runtime \
    && chown -R node:node /app/uploads /app/data/dsd/runtime
USER node

EXPOSE 7474

CMD ["node", "dist/src/main.js"]
