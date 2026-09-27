FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./

# نصب تایپ‌اسکریپت و وابستگی‌ها منحصراً از مخزن ابرها
RUN npm install -g typescript --registry="https://mirror.abrha.net/repository/npm/" --strict-ssl=false && \
    npm install --legacy-peer-deps --registry="https://mirror.abrha.net/repository/npm/" --strict-ssl=false

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 5000
CMD ["node", "dist/index.js"]