# Airlink v3.0 web tier — builds the React SPA and serves it via nginx, proxying
# /api to the php-fpm backend (fastcgi). Build context is the repo root.
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
ENV VITE_API_URL=/api
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Source files can be 0640 (restrictive umask on the checkout) and vite preserves
# modes; the nginx worker runs as `nginx`, so make the web root world-readable.
RUN chmod -R a+rX /usr/share/nginx/html
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
