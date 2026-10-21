FROM node:20-alpine AS build
WORKDIR /app
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm --prefix server ci && npm --prefix web ci
COPY server server
COPY web web
RUN npm --prefix web run build && npm --prefix server run build

FROM node:20-alpine
RUN apk add --no-cache postgresql16-client
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build /app/server /app/server
COPY --from=build /app/web/dist /app/web/dist
WORKDIR /app/server
RUN mkdir -p storage/uploads storage/backups
EXPOSE 3001
CMD ["node", "dist/index.js"]
