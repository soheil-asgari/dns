FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json .npmrc* ./
RUN npm config set strict-ssl false && \
    npm config set registry https://registry.npmjs.org/ && \
    if [ -f package-lock.json ]; then \
      npm ci --prefer-offline; \
    else \
      npm install --prefer-offline; \
    fi
COPY . .
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]