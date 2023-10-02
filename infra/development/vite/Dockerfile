FROM node:16-slim
COPY ./laravel/package.json /work/laravel/package.json
COPY ./laravel/vite.config.js /work/laravel/vite.config.js
WORKDIR /work/laravel
RUN npm install
CMD ["npm", "run", "dev"]