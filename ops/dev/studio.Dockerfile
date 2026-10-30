# The owned Studio Dockerfile builds binaries, plugins and Agent dependencies.
ARG STUDIO_BASE_IMAGE
FROM ${STUDIO_BASE_IMAGE}
USER root
RUN apk add --no-cache ffmpeg
USER app
ENV CANVAS_FFMPEG_PATH=/usr/bin/ffmpeg
