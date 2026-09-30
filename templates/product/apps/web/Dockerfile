# wOS Web, self-hosted. Build the bundle first (npm run build), then: docker build -t wos-web .
# The image holds only the esbuild bundle: no node_modules, no source, no install scripts.
FROM node:22-alpine
WORKDIR /app
COPY dist/server.mjs ./
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
