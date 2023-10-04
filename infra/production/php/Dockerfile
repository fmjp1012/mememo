FROM php:8.1-fpm

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

RUN apt-get update && \
  apt-get -y install git libicu-dev libonig-dev libzip-dev unzip locales && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* && \
  locale-gen en_US.UTF-8 && \
  localedef -f UTF-8 -i en_US en_US.UTF-8 && \
  mkdir /var/run/php-fpm && \
  docker-php-ext-install intl pdo_mysql zip bcmath && \
  composer config -g process-timeout 3600 && \
  composer config -g repos.packagist composer https://packagist.org

COPY ./php-fpm.d/zzz-www.conf /usr/local/etc/php-fpm.d/zzz-www.conf
COPY ../laravel /work/laravel

RUN cp /work/laravel/.env.example /work/laravel/.env && \
  composer install && \
  php artisan key:generate && \
  php artisan config:cache && \
  php artisan route:cache && \
  php artisan view:cache && \
  php artisan storage:link && \
  chown -R www-data:www-data /work/laravel && \
  chmod -R 777 /work/laravel/storage && \
  chmod -R 777 /work/laravel/bootstrap/cache

WORKDIR /work/laravel