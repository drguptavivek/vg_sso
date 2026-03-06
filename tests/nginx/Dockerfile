FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

RUN mkdir -p /etc/nginx/certs \
 && openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout /etc/nginx/certs/sso1.local.test.key \
    -out /etc/nginx/certs/sso1.local.test.crt \
    -subj "/CN=sso1.local.test" \
 && openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout /etc/nginx/certs/sso2.local.test.key \
    -out /etc/nginx/certs/sso2.local.test.crt \
    -subj "/CN=sso2.local.test"
