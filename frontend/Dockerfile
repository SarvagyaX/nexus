# Stage 1: Development target (used by local docker-compose.yml)
FROM node:22-alpine AS development

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# Stage 2: Production builder
FROM development AS builder
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Stage 3: Production hardened Nginx server
FROM nginx:1.27-alpine AS production

RUN rm -rf /usr/share/nginx/html/* \
    && mkdir -p /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html \
    && chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html \
    && sed -i 's/\/var\/run\/nginx.pid/\/tmp\/nginx.pid/g' /etc/nginx/nginx.conf \
    && sed -i '/user  nginx;/d' /etc/nginx/nginx.conf

COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 --start-period=5s \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
