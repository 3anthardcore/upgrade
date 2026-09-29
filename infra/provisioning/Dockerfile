ARG PHP_IMAGE
FROM ${PHP_IMAGE}
# Build-time dependency retrieval happens before any licensed/customer PHP is mounted.
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev libzip-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev libonig-dev libxml2-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j2 mysqli pdo_mysql mbstring intl zip gd soap opcache \
    && rm -rf /var/lib/apt/lists/*
COPY provisioning/demo.ini /usr/local/etc/php/conf.d/zz-upgrade-demo.ini
COPY provisioning/fpm.conf /usr/local/etc/php-fpm.d/zz-upgrade.conf
COPY provisioning/prepend.php /opt/upgrade/prepend.php
WORKDIR /var/www/html
# No cron, mail transfer agent, copied startup hooks or source-site entrypoint.
CMD ["php-fpm", "-F"]
