FROM wordpress:6.4-php8.2-apache

# Metadatos
LABEL maintainer="wpsite-cli"
LABEL description="WordPress development container with Git support"
LABEL version="1.3.0"

# Actualizar repositorios e instalar herramientas de desarrollo
RUN apt-get update && \
    apt-get install -y \
    git \
    curl \
    wget \
    nano \
    vim \
    unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Configurar Git con valores por defecto para desarrollo
RUN git config --global user.name "WPSite Developer" && \
    git config --global user.email "developer@wpsite.local" && \
    git config --global init.defaultBranch main

# Configurar Apache para desarrollo
RUN echo "ServerName localhost" >> /etc/apache2/apache2.conf

# Habilitar módulos de Apache necesarios
RUN a2enmod rewrite

# Configurar PHP para desarrollo
RUN { \
    echo 'display_errors = On'; \
    echo 'display_startup_errors = On'; \
    echo 'log_errors = On'; \
    echo 'error_log = /dev/stderr'; \
    echo 'log_errors_max_len = 1024'; \
    echo 'ignore_repeated_errors = On'; \
    echo 'ignore_repeated_source = Off'; \
    echo 'html_errors = Off'; \
    echo 'upload_max_filesize = 64M'; \
    echo 'post_max_size = 64M'; \
    echo 'memory_limit = 256M'; \
    echo 'max_execution_time = 300'; \
    echo 'max_input_vars = 3000'; \
    } > /usr/local/etc/php/conf.d/development.ini

# Crear directorio para logs personalizados
RUN mkdir -p /var/log/wpsite && \
    chown www-data:www-data /var/log/wpsite

# Exponer puerto
EXPOSE 80

# Comando por defecto
CMD ["apache2-foreground"]