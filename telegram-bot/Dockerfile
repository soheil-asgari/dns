FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./

# نصب تایپ‌اسکریپت و وابستگی‌ها - سعی می‌کنه اول از رجیستری پیشفرض نصب کنه،
# در صورت خطا از mirror استفاده می‌کنه
RUN npm install -g typescript --strict-ssl=false 2>/dev/null || \
    npm install -g typescript --registry="https://mirror.abrha.net/repository/npm/" --strict-ssl=false

RUN npm install --legacy-peer-deps --strict-ssl=false 2>/dev/null || \
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