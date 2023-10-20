FROM node:21-alpine as builder

WORKDIR /app

COPY package.json .
COPY yarn.lock .

RUN echo network-timeout 600000 > .yarnrc && \
  yarn install --frozen-lockfile && \
  yarn cache clean

COPY src src
COPY tsconfig.json .

RUN yarn package

FROM alpine:3 as version-getter

WORKDIR /app

COPY package.json .

# hadolint ignore=DL3018
RUN apk update && \
  apk upgrade && \
  apk add --update --no-cache jq && \
  rm -rf /var/cache/apk/* && \
  jq -r '.version' package.json > version

FROM node:21-alpine as runner

# hadolint ignore=DL3018
RUN apk update && \
  apk upgrade && \
  apk add --update --no-cache tzdata && \
  cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
  echo "Asia/Tokyo" > /etc/timezone && \
  apk del tzdata

WORKDIR /app

COPY --from=builder /app/output .
COPY --from=version-getter /app/version version
COPY src/public public

ENV NODE_ENV production
ENV CONFIG_PATH /data/config.json
ENV CHECKED_PATH /data/checked.json
ENV PHONES_PATH /data/phones.tsv
ENV WEB_PUSH_KEY_PATH /data/web-push-key.json
ENV WEB_PUSH_SUBSCRIPTIONS_PATH /data/web-push-subscriptions.json
ENV WEB_PUSH_EMAIL no-reply@example.com
ENV LOG_DIR /data/logs/
ENV API_PORT 80

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

VOLUME [ "/data" ]

ENTRYPOINT [ "/app/entrypoint.sh" ]
