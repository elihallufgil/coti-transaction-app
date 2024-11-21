#!/bin/sh

DOCKER_BUILDKIT=1 docker-compose build $1 \
  --build-arg BUILD_BRANCH="$(cd $2 && git rev-parse --abbrev-ref HEAD)" \
  --build-arg BUILD_COMMIT="$(cd $2 && git rev-parse HEAD)" \
  --build-arg BUILD_DATE="$(date -u '+%Y-%m-%d %H:%M:%S')"