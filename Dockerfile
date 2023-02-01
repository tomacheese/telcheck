FROM node:19-alpine as builder

WORKDIR /app

COPY package.json .
COPY yarn.lock .

RUN echo network-timeout 600000 > .yarnrc && \
  yarn install --frozen-lockfile && \
  yarn cache clean

COPY src src
COPY tsconfig.json .

RUN yarn package

FROM node:19-alpine as runner

# hadolint ignore=DL3018
RUN apk update && \
  apk upgrade && \
  apk add --update --no-cache tzdata && \
  cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
  echo "Asia/Tokyo" > /etc/timezone && \
  apk del tzdata

WORKDIR /app

COPY --from=builder /app/output .

ENV NODE_ENV=production
ENV CONFIG_PATH=/data/config.json
ENV CHECKED_PATH=/data/checked.json
ENV PHONES_PATH=/data/phones.tsv
ENV LOG_DIR=/data/logs/

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

VOLUME [ "/data" ]

ENTRYPOINT [ "/app/entrypoint.sh" ]
