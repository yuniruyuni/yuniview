FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /agent . && mkdir /state && chown 65532:65532 /state

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /state /var/lib/yuniview-agent
COPY --from=build /agent /yuniview-agent
USER 65532:65532
ENTRYPOINT ["/yuniview-agent"]
