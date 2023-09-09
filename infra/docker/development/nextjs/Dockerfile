FROM node:16.14.0

WORKDIR /work/nextjs

RUN npm install -g npm@8.1.0

EXPOSE 3000

COPY ./infra/docker/development/nextjs/package.json /work/nextjs/package.json

RUN npm install

CMD ["npm", "run", "dev"]