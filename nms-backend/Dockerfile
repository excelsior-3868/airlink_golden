FROM golang:alpine AS build
RUN apk add --no-cache git ca-certificates tzdata
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/nms-server ./cmd/nms-server

FROM alpine:3.20
# openvpn needs root + NET_ADMIN to create the tun device and routes
RUN apk add --no-cache ca-certificates tzdata openvpn iproute2
COPY --from=build /out/nms-server /usr/local/bin/nms-server
EXPOSE 8080
ENTRYPOINT ["nms-server"]

