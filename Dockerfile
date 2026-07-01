FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS deps
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --ignore-scripts

FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json .npmrc tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "const http=require('node:http');const port=process.env.PORT||3000;const allowed=(process.env.MCP_ALLOWED_HOSTS||'127.0.0.1').split(',').map(value=>value.trim()).filter(Boolean);const host=allowed[0]||'127.0.0.1';const req=http.request({hostname:'127.0.0.1',port,path:'/healthz',method:'GET',headers:{Host:host},timeout:2500},res=>{res.resume();process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1)});req.end()"]
CMD ["node", "dist/src/server.js"]
