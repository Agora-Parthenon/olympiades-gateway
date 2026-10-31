FROM node:18-alpine
WORKDIR /app
COPY package.json package.json
RUN npm install --production
COPY index.js addresses.js user-headers.js ./
EXPOSE 8080
CMD ["node","index.js"]
