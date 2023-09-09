FROM php:8.1-fpm

RUN mkdir /var/run/php-fpm

COPY ./infra/docker/development/php/php-fpm.d/zzz-www.conf /usr/local/etc/php-fpm.d/zzz-www.conf

# WORKDIR /work/laravel