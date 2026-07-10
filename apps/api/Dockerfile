FROM node:22-alpine AS build

WORKDIR /workspace
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY packages/shared/package*.json packages/shared/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace packages/shared
RUN npm run build --workspace apps/api

FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY packages/shared/package*.json packages/shared/
RUN npm ci --omit=dev

COPY --from=build /workspace/apps/api/dist apps/api/dist
COPY --from=build /workspace/packages/shared/dist packages/shared/dist

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["npm", "run", "start", "--workspace", "apps/api"]
