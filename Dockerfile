FROM nginx:alpine
RUN apk add --no-cache curl
COPY *.html /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
