FROM node:22-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY server.js ./
COPY public/ ./public/

# Expose server port
EXPOSE 3009

# Define environment defaults
ENV PORT=3009
ENV PASSWORD=Suvojeet123

# Start application
CMD ["node", "server.js"]
