FROM golang:1.26-alpine AS build
WORKDIR /src
COPY services/platform/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/platform-api ./cmd/platform-api

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 platform
COPY --from=build /out/platform-api /usr/local/bin/platform-api
USER platform
ENV PLATFORM_ADDR=:8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/api/health/ready >/dev/null || exit 1
CMD ["platform-api"]
