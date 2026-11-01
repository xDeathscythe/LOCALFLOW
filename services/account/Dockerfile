FROM node:24-bookworm-slim
WORKDIR /app/services/account
COPY services/account/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/account/*.mjs ./
COPY host/account/http.mjs host/account/protocol.mjs /app/host/account/
ENV NODE_ENV=production LOCALFLOW_ACCOUNT_DATA=/data LOCALFLOW_ACCOUNT_BIND=0.0.0.0
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8788
CMD ["node", "server.mjs"]
