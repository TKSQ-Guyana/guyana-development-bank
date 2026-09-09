# gdb-frontend: React citizen portal served by nginx, proxying /api to the
# gdb-backend (ERPNext) service.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
ENV BACKEND_URL=http://gdb-backend:8000 \
    FRAPPE_SITE_NAME=gdb.localhost
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
