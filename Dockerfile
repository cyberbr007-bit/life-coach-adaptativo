FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY db ./db
COPY agent/constitution.md ./agent/constitution.md
USER node
CMD ["node","src/cli.ts","serve"]

