FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY mcp-server.js ./
EXPOSE 8791
CMD ["node", "mcp-server.js"]
