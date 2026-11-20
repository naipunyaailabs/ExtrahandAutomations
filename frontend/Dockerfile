# ExtraHand Intelligence Platform: Frontend React Dashboard
# Stage 1: Build the Vite production bundle
FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./

# Empty = same address as the dashboard (/api is passed to the backend by nginx.conf)
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# Stage 2: Lightweight Nginx Alpine web server
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3074

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3074/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
