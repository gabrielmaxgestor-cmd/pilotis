FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_COMPANY_EMAIL=empresa@pilotis.com.br
ARG VITE_DAILY_LOG_PHOTO_BACKEND=firestore
ENV VITE_COMPANY_EMAIL=${VITE_COMPANY_EMAIL} VITE_DAILY_LOG_PHOTO_BACKEND=${VITE_DAILY_LOG_PHOTO_BACKEND}
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/server.js /app/firebase-applet-config.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
USER node
EXPOSE 8080
CMD ["node", "server.js"]
