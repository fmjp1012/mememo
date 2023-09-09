FROM node:latest

COPY ./infra/docker/development/nextjs/package.json /work/nextjs/package.json

RUN npm install -g npm@latest
RUN npm install

EXPOSE 3000
WORKDIR /work/nextjs
CMD ["npm", "run", "dev"]