# 1. Install all dependencies for building
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2. Build the application
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# 3. Create a production-only node_modules with Prisma client
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

# 4. Final production image
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Copy prod dependencies (includes generated Prisma client!)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# If you have specific generated non-prisma src files:
COPY --from=build /app/src/generated ./dist/generated 
COPY prisma ./prisma
COPY package.json ./
EXPOSE 4000
CMD ["node", "dist/index.js"]
