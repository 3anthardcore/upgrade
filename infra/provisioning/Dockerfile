ARG PHP_IMAGE
FROM ${PHP_IMAGE}
# Build-time dependency retrieval happens before any licensed/customer PHP is mounted.
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev libzip-dev libpng-dev libjpeg62-turbo-dev libfreetype6-dev libonig-dev libxml2-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j2 mysqli pdo_mysql mbstring intl zip gd soap opcache \
    && rm -rf /var/lib/apt/lists/*
# These own files contain no secrets. Do not inherit a release archive's 0640:
# the non-root FPM worker must read the prepend before any target PHP executes.
COPY provisioning/demo.ini /usr/local/etc/php/conf.d/zz-upgrade-demo.ini
COPY provisioning/fpm.conf /usr/local/etc/php-fpm.d/zz-upgrade.conf
COPY provisioning/prepend.php /opt/upgrade/prepend.php
# Plain COPY plus explicit modes also works with the server's legacy builder.
RUN chown 0:0 /usr/local/etc/php/conf.d/zz-upgrade-demo.ini /usr/local/etc/php-fpm.d/zz-upgrade.conf /opt/upgrade/prepend.php \
    && chmod 0644 /usr/local/etc/php/conf.d/zz-upgrade-demo.ini /usr/local/etc/php-fpm.d/zz-upgrade.conf /opt/upgrade/prepend.php \
    && chmod 0755 /opt/upgrade
WORKDIR /var/www/html
# No cron, mail transfer agent, copied startup hooks or source-site entrypoint.
CMD ["php-fpm", "-F"]
