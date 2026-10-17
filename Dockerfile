FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
RUN useradd --system --uid 10001 --create-home app && mkdir -p /app/data && chown -R app:app /app
WORKDIR /app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json server.js ./
USER app
EXPOSE 3000
CMD ["node","server.js"]
