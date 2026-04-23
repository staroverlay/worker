# Use the official Bun image as the base
FROM oven/bun:1.1-slim AS base
WORKDIR /app

# --- Stage 1: Dependencies ---
# Install dependencies into a temporary directory to cache them
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Install production dependencies only
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# --- Stage 2: Build/Prerelease ---
# Copy all files and build (if necessary)
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# [Optional] Run tests or build scripts here
# RUN bun test
# RUN bun run build 

# --- Stage 3: Production Release ---
# Final image for production
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /app/src src
COPY --from=prerelease /app/package.json .
COPY --from=prerelease /app/tsconfig.json .

# Set production environment
ENV NODE_ENV=production
# Default port for the worker
ENV PORT=3000

# Expose the port
EXPOSE 3000/tcp

# Run the application
# Since Hono's 'export default app' works directly with Bun's server
# we can point Bun to the entry file.
USER bun
ENTRYPOINT [ "bun", "run", "src/server.ts" ]
