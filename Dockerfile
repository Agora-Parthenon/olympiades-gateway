FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js addresses.js user-headers.js ./
EXPOSE 8080
CMD ["node","index.js"]
