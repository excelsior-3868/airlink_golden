# Airlink v3.0 backend — Laravel 13 (PHP 8.3) dev image.
# Ships the PHP runtime + extensions + composer; app code is bind-mounted in
# dev (see docker-compose.yml) and `composer install` runs from the entrypoint.
FROM php:8.3.36-cli-bookworm

# System libs needed to build the PHP extensions below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libzip-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
        libicu-dev default-mysql-client \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql bcmath gd zip intl pcntl sockets \
    && rm -rf /var/lib/apt/lists/*

# Composer (from the official image).
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

ENV COMPOSER_ALLOW_SUPERUSER=1
WORKDIR /var/www/html

# Raise request-body / memory limits for base64 voucher card uploads.
COPY php.ini /usr/local/etc/php/conf.d/zz-airlink.ini

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["entrypoint.sh"]
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
