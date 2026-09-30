# wOS Core, self-hosted. Build the bundle first (npm run build), then: docker build -t wos-api .
# The image holds only the esbuild bundle: no node_modules, no source, no install scripts.
FROM node:22-alpine
WORKDIR /app
COPY dist/server.mjs dist/cli.mjs ./
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
