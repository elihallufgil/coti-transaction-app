FROM node:18-slim AS builder
WORKDIR /app
COPY ./package*.json ./
RUN npm install
COPY . .
RUN npm run build


FROM node:18-slim
ARG BUILD_BRANCH
ARG BUILD_COMMIT
ARG BUILD_DATE
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm install --only=production
RUN <<EOF cat > build-info
Branch=${BUILD_BRANCH}
Commit=${BUILD_COMMIT}
Date=${BUILD_DATE}
EOF
CMD [ "sh", "-c", "npm run start:prod"]