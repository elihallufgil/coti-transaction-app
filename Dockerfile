FROM node:18-slim AS builder
ARG APPLICATION_NAME
WORKDIR /app
COPY ./package*.json ./
RUN npm install
COPY . .
RUN npm run build-${APPLICATION_NAME}


FROM node:18-slim
ARG APPLICATION_NAME
ARG BUILD_BRANCH
ARG BUILD_COMMIT
ARG BUILD_DATE
ENV APPLICATION_NAME=${APPLICATION_NAME}
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm install --only=production
RUN <<EOF cat > build-info
Branch=${BUILD_BRANCH}
Commit=${BUILD_COMMIT}
Date=${BUILD_DATE}
EOF
CMD npm run start-${APPLICATION_NAME}:prod