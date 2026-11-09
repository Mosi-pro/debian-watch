FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /mosideck ./cmd/mosideck

FROM alpine:3.20
RUN apk add --no-cache bash sudo htop tmux vim curl \
 && adduser -D -s /bin/bash mosideck && mkdir -p /data && chown mosideck /data
COPY --from=build /mosideck /usr/local/bin/mosideck
COPY deploy/mosideck.config.toml /etc/mosideck/config.toml
USER mosideck
EXPOSE 8443
VOLUME /data
ENTRYPOINT ["mosideck", "-c", "/etc/mosideck/config.toml"]
CMD ["serve"]
