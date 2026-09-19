FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json .npmrc* ./
RUN npm config set registry https://mirror.abrha.net/repository/npm/ && npm config set strict-ssl false
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 5000
CMD ["node", "dist/index.js"]