# strfry, built from a pinned release, with python3 for the write policy.
# Based on strfry's own Dockerfile (https://github.com/hoytech/strfry).
FROM alpine:3.18.3 AS build

ARG STRFRY_VERSION=1.1.3
WORKDIR /build

RUN apk --no-cache add \
    linux-headers git g++ make perl pkgconfig libtool ca-certificates \
    libressl-dev zlib-dev lmdb-dev flatbuffers-dev libsecp256k1-dev zstd-dev

RUN git clone --depth 1 --branch "${STRFRY_VERSION}" --recurse-submodules \
    https://github.com/hoytech/strfry.git .

RUN make setup-golpe && make -j4

FROM alpine:3.18.3

WORKDIR /app

RUN apk --no-cache add lmdb flatbuffers libsecp256k1 libb2 zstd libressl python3 \
  && rm -rf /var/cache/apk/*

RUN adduser -D -h /app -s /bin/sh strfry && mkdir -p /app/strfry-db && chown -R strfry:strfry /app
USER strfry

COPY --from=build --chown=strfry:strfry /build/strfry /app/strfry
COPY --chown=strfry:strfry strfry.conf /app/strfry.conf
# Behind a proxy (production: Cloudflare), the header holding the client's
# address, so strfry logs and limits real clients rather than the proxy.
ARG REAL_IP_HEADER=""
RUN sed -i "s/^\( *realIpHeader = \)\"\"/\1\"${REAL_IP_HEADER}\"/" /app/strfry.conf
COPY --chown=strfry:strfry --chmod=755 policy.py /app/policy.py

VOLUME /app/strfry-db
EXPOSE 7777

ENTRYPOINT ["/app/strfry"]
CMD ["relay"]
