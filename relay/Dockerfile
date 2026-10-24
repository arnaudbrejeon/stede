# strfry, from its author's image (ghcr.io/hoytech/strfry, pinned), with
# python3 for the write policy and our configuration. Nothing is compiled, so
# it builds in seconds, even on a small VM.
FROM ghcr.io/hoytech/strfry@sha256:36f1886d185a88ca57c66ebe52e6e9e8428dac2486eea0a5d50ff934f18b60c3

USER root
# The image ships with the OpenSSL and musl of its Alpine release (3.18, end of
# life): take the fixes the release still has before adding anything to it.
RUN apk --no-cache upgrade && apk --no-cache add python3
USER strfry

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
