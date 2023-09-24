FROM node:16-slim
WORKDIR /work/laravel

COPY ./laravel/package* .
RUN npm ci
COPY ./laravel/vite.config.js .

CMD ["npm", "run", "dev"]