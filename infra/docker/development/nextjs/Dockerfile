FROM node:18-alpine AS base

WORKDIR /work/nextjs
COPY ./nextjs ./

RUN npm install

CMD ["npm", "run", "dev"]
