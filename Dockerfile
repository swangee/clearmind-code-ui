FROM node:22-alpine AS builder

WORKDIR /src

COPY package.json ./
COPY contracts/package.json ./contracts/
RUN npm install --no-audit --no-fund

COPY contracts ./contracts
COPY . .

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /src/dist /usr/share/nginx/html

ENV API_GATEWAY_URL=http://api-gateway \
    NGINX_ENVSUBST_TEMPLATE_SUFFIX=.template

RUN sed -i 's|^pid .*|pid /tmp/nginx.pid;|; s|^user .*||' /etc/nginx/nginx.conf \
 && chown -R 101:101 /usr/share/nginx/html /var/cache/nginx /etc/nginx \
 && chmod -R g+w /etc/nginx/conf.d

USER 101
EXPOSE 8080
