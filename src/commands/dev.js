const { spawn, exec } = require('child_process');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const DockerHelper = require('../utils/docker-helper');

module.exports = async (options = {}) => {
  const spinner = ora('Iniciando WordPress...').start();
  const port = options.port || 8080;
  
  try {
    // 1. Verificar Docker (única dependencia)
    await checkDockerRequirement(spinner);
    
    // 2. Verificar wp-content
    if (!fs.existsSync('./wp-content')) {
      spinner.fail('❌ No se encontró wp-content/');
      console.log(chalk.yellow('Asegúrate de estar en un directorio con wp-content/ clonado desde GitHub'));
      console.log(chalk.blue('Ejemplo:'));
      console.log(chalk.blue('  git clone tu-repo.git .'));
      console.log(chalk.blue('  wpsite dev'));
      return;
    }

    // 3. Verificar configuración
    if (!fs.existsSync('./wpsite.config.js')) {
      spinner.fail('❌ No se encontró wpsite.config.js');
      console.log(chalk.yellow('Ejecuta: wpsite init'));
      return;
    }

    // 4. Verificar que el puerto esté disponible
    const isPortAvailable = await DockerHelper.checkPortAvailable(port);
    if (!isPortAvailable) {
      spinner.fail(`❌ El puerto ${port} ya está en uso`);
      console.log(chalk.yellow(`Prueba con otro puerto: wpsite dev --port ${parseInt(port) + 1}`));
      return;
    }

    // 5. Preparar WordPress y configuración
    await prepareWordPressWithDocker(spinner, port);
    
    // 6. Iniciar contenedor Docker
    const containerId = await startDockerContainer(spinner, port);
    
    // 7. Esperar a que WordPress esté listo
    await waitForWordPress(spinner, port);
    
    // 8. Mostrar información
    spinner.succeed(`🚀 WordPress corriendo en ${chalk.green(`http://localhost:${port}`)}`);
    console.log(chalk.blue('🐳 Servidor: Docker (php:8.2-apache)'));
    console.log(chalk.blue('📁 wp-content: Local (desde GitHub)'));
    console.log(chalk.blue('🗃️ Base de datos: Remota'));
    console.log(chalk.magenta(`📋 Container ID: ${containerId.substring(0, 12)}`));
    console.log(chalk.yellow('\n✨ Presiona Ctrl+C para detener\n'));

    // 9. Cleanup al cerrar
    process.on('SIGINT', async () => {
      console.log(chalk.red('\n🛑 Deteniendo contenedor...'));
      await stopDockerContainer(containerId);
      console.log(chalk.green('✅ Contenedor detenido correctamente'));
      process.exit(0);
    });

    // 10. Mantener el proceso vivo
    process.stdin.resume();

  } catch (error) {
    spinner.fail(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

// Verificar que Docker esté disponible
async function checkDockerRequirement(spinner) {
  spinner.text = 'Verificando Docker...';
  
  return new Promise((resolve, reject) => {
    exec('docker --version', (error, stdout) => {
      if (error) {
        spinner.fail('❌ Docker no está instalado');
        console.log(chalk.yellow('\n📦 wpsite requiere Docker para funcionar:'));
        console.log(chalk.blue('   Windows: https://docs.docker.com/desktop/windows/install/'));
        console.log(chalk.blue('   Mac: https://docs.docker.com/desktop/mac/install/'));
        console.log(chalk.blue('   Linux: https://docs.docker.com/engine/install/'));
        console.log(chalk.yellow('\n🔄 Después de instalar Docker, reinicia y vuelve a intentar'));
        reject(new Error('Docker no encontrado'));
        return;
      }
      
      // Verificar que Docker esté corriendo
      exec('docker info', (infoError) => {
        if (infoError) {
          spinner.fail('❌ Docker no está corriendo');
          console.log(chalk.yellow('\n🔄 Inicia Docker Desktop y vuelve a intentar'));
          reject(new Error('Docker no está corriendo'));
          return;
        }
        
        const version = stdout.trim().replace('Docker version ', '');
        spinner.text = `Docker encontrado: ${version}`;
        resolve();
      });
    });
  });
}

// Preparar WordPress usando contenedor temporal
async function prepareWordPressWithDocker(spinner, port) {
  // Si WordPress no existe, descargarlo
  if (!fs.existsSync('./wordpress')) {
    spinner.text = 'Descargando WordPress...';
    await downloadWordPressWithDocker();
  }
  
  // Crear wp-config.php
  spinner.text = 'Creando configuración...';
  await createWordPressConfig(port);
  
  // Configurar wp-content
  spinner.text = 'Configurando wp-content...';
  await setupCustomContent();
}

// Descargar WordPress usando contenedor Docker temporal
async function downloadWordPressWithDocker() {
  return new Promise((resolve, reject) => {
    const downloadCmd = spawn('docker', [
      'run', '--rm',
      '-v', `${process.cwd()}:/workspace`,
      '-w', '/workspace',
      'alpine/curl:latest',
      'sh', '-c',
      'curl -L -o wordpress.zip https://wordpress.org/latest.zip && unzip -q wordpress.zip && rm wordpress.zip'
    ], { stdio: 'pipe' });

    downloadCmd.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Error descargando WordPress'));
      }
    });

    downloadCmd.on('error', (error) => {
      reject(new Error(`Error ejecutando Docker: ${error.message}`));
    });
  });
}

// Crear configuración de WordPress
async function createWordPressConfig(port) {
  const configPath = path.join(process.cwd(), 'wpsite.config.js');
  
  // Verificar que el archivo existe
  if (!fs.existsSync(configPath)) {
    throw new Error('wpsite.config.js no encontrado');
  }
  
  // Limpiar cache y cargar configuración
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);
  
  const wpConfig = `<?php
/**
 * WordPress Configuration - Desarrollo con Docker
 * Generado automáticamente por wpsite CLI
 */

// === CONFIGURACIÓN DE BASE DE DATOS ===
define('DB_NAME', '${config.database.name}');
define('DB_USER', '${config.database.user}');
define('DB_PASSWORD', '${config.database.password}');
define('DB_HOST', '${config.database.host}');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

// === URLs DINÁMICAS ===
define('WP_HOME', 'http://localhost:${port}');
define('WP_SITEURL', 'http://localhost:${port}');

// === CONFIGURACIÓN DE DEBUG ===
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', true);
define('SCRIPT_DEBUG', true);

// === CONTENT DIRECTORY PERSONALIZADO ===
define('WP_CONTENT_DIR', dirname(__FILE__) . '/wp-content-local');
define('WP_CONTENT_URL', 'http://localhost:${port}/wp-content-local');

// === DESACTIVAR ACTUALIZACIONES ===
define('AUTOMATIC_UPDATER_DISABLED', true);
define('WP_AUTO_UPDATE_CORE', false);

// === CLAVES DE SEGURIDAD ===
// Claves temporales para desarrollo - cambiar en producción
define('AUTH_KEY',         'docker-dev-auth-key-' . time());
define('SECURE_AUTH_KEY',  'docker-dev-secure-auth-key-' . time());
define('LOGGED_IN_KEY',    'docker-dev-logged-in-key-' . time());
define('NONCE_KEY',        'docker-dev-nonce-key-' . time());
define('AUTH_SALT',        'docker-dev-auth-salt-' . time());
define('SECURE_AUTH_SALT', 'docker-dev-secure-auth-salt-' . time());
define('LOGGED_IN_SALT',   'docker-dev-logged-in-salt-' . time());
define('NONCE_SALT',       'docker-dev-nonce-salt-' . time());

// === CONFIGURACIÓN DE TABLA ===
\$table_prefix = '${config.database.tablePrefix || 'wp_'}';

// === CONFIGURACIÓN FINAL ===
if (!defined('ABSPATH')) {
    define('ABSPATH', dirname(__FILE__) . '/');
}

/** Configurar variables WordPress y archivos incluidos. */
require_once ABSPATH . 'wp-settings.php';
`;

  // Eliminar archivo existente si existe
  const wpConfigPath = './wordpress/wp-config.php';
  if (fs.existsSync(wpConfigPath)) {
    fs.unlinkSync(wpConfigPath);
  }

  fs.writeFileSync(wpConfigPath, wpConfig);
}

// Configurar symlink para wp-content
async function setupCustomContent() {
  const customContentPath = './wordpress/wp-content-local';
  
  // Eliminar symlink existente si existe
  if (fs.existsSync(customContentPath)) {
    if (fs.lstatSync(customContentPath).isSymbolicLink()) {
      fs.unlinkSync(customContentPath);
    } else {
      // Si es directorio, eliminarlo recursivamente
      fs.rmSync(customContentPath, { recursive: true, force: true });
    }
  }
  
  // Crear symlink
  const absoluteWpContent = path.resolve('./wp-content');
  fs.symlinkSync(absoluteWpContent, customContentPath);
}

// Iniciar contenedor Docker principal
async function startDockerContainer(spinner, port) {
  spinner.text = 'Iniciando contenedor Docker...';
  
  return new Promise((resolve, reject) => {
    const containerName = `wpsite-dev-${port}`;
    
    // Primero intentar remover contenedor existente si existe
    exec(`docker rm -f ${containerName}`, () => {
      // Iniciar nuevo contenedor
      const dockerArgs = [
        'run', '-d',
        '--name', containerName,
        '-p', `${port}:80`,
        '-v', `${process.cwd()}/wordpress:/var/www/html`,
        'php:8.2-apache'
      ];

      const containerStart = spawn('docker', dockerArgs, { stdio: 'pipe' });
      
      let containerId = '';
      let errorOutput = '';
      
      containerStart.stdout.on('data', (data) => {
        containerId += data.toString().trim();
      });

      containerStart.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      containerStart.on('close', (code) => {
        if (code === 0 && containerId) {
          resolve(containerId);
        } else {
          reject(new Error(`Error iniciando contenedor: ${errorOutput}`));
        }
      });
    });
  });
}

// Esperar a que WordPress esté disponible
async function waitForWordPress(spinner, port) {
  spinner.text = 'Esperando a que WordPress esté listo...';
  
  return new Promise((resolve) => {
    const checkWordPress = () => {
      exec(`curl -f http://localhost:${port} >/dev/null 2>&1`, (error) => {
        if (error) {
          setTimeout(checkWordPress, 1000);
        } else {
          resolve();
        }
      });
    };
    
    setTimeout(checkWordPress, 2000); // Esperar 2 segundos antes del primer check
  });
}

// Detener contenedor Docker
async function stopDockerContainer(containerId) {
  return new Promise((resolve) => {
    const stopCmd = spawn('docker', ['stop', containerId], { stdio: 'pipe' });
    
    stopCmd.on('close', () => {
      // También remover el contenedor
      const removeCmd = spawn('docker', ['rm', containerId], { stdio: 'pipe' });
      removeCmd.on('close', () => resolve());
    });
  });
}