const { spawn, exec } = require('child_process');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const https = require('https');
const DockerHelper = require('../utils/docker-helper');

module.exports = async (options = {}) => {
  const spinner = ora('Iniciando WordPress...').start();
  const port = options.port || 8080;
  const useTunnel = options.tunel || options.tunnel; // Soportar ambas escrituras

  let ngrokTunnel = null;

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

    // 4. Limpiar contenedores existentes de wpsite
    await cleanupAllWPSiteContainers(spinner);

    // 5. Verificar que el puerto esté disponible
    const isPortAvailable = await DockerHelper.checkPortAvailable(port);
    if (!isPortAvailable) {
      spinner.fail(`❌ El puerto ${port} ya está en uso`);
      console.log(chalk.yellow(`Prueba con otro puerto: wpsite dev --port ${parseInt(port) + 1}`));
      return;
    }

    // 6. Preparar WordPress y configuración
    await prepareWordPressWithDocker(spinner, port);

    // 7. Iniciar contenedor Docker
    const containerId = await startDockerContainer(spinner, port);

    // 8. Esperar a que WordPress esté listo
    await waitForWordPress(spinner, port);

    // 8. Iniciar túnel ngrok si se solicita (AGREGAR DESPUÉS DE waitForWordPress)
    if (useTunnel) {
      try {
        ngrokTunnel = await startNgrokTunnel(port, spinner);
      } catch (error) {
        console.log(chalk.yellow(`⚠️ No se pudo iniciar túnel: ${error.message}`));
        console.log(chalk.blue('   Continuando sin túnel...'));
      }
    }


    // 9. Mostrar información
    spinner.succeed(`🚀 WordPress corriendo en ${chalk.green(`http://localhost:${port}`)}`);
    console.log(chalk.blue('🐳 Servidor: Docker (wordpress:6.4-php8.2-apache)'));
    console.log(chalk.blue('📁 wp-content: Local (desde GitHub)'));
    console.log(chalk.blue('🗃️ Base de datos: Remota'));
    console.log(chalk.magenta(`📋 Container ID: ${containerId.substring(0, 12)}`));
    console.log(chalk.yellow('\n✨ Presiona Ctrl+C para detener\n'));

    // Mostrar URL del túnel si está activo
    if (ngrokTunnel && ngrokTunnel.url) {
      console.log(chalk.magenta(`🌍 Túnel público: ${ngrokTunnel.url}`));
      console.log(chalk.yellow('💡 Comparte esta URL con otros desarrolladores'));
    }

    // 10. Cleanup al cerrar
    process.on('SIGINT', async () => {
      console.log(chalk.red('\n🛑 Deteniendo contenedor...'));
      await stopDockerContainer(containerId);
      console.log(chalk.green('✅ Contenedor detenido correctamente'));
      process.exit(0);
    });

    // 11. Mantener el proceso vivo
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

// Limpiar todos los contenedores wpsite existentes
async function cleanupAllWPSiteContainers(spinner) {
  spinner.text = 'Limpiando contenedores anteriores...';

  return new Promise((resolve) => {
    // Buscar todos los contenedores que empiecen con wpsite-dev
    exec('docker ps -aq --filter "name=wpsite-dev"', (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve();
        return;
      }

      const containerIds = stdout.trim().split('\n').filter(id => id);

      if (containerIds.length > 0) {
        console.log(chalk.yellow(`🧹 Encontrados ${containerIds.length} contenedores wpsite, limpiando...`));

        // Detener y remover todos los contenedores wpsite
        const cleanupCmd = spawn('docker', ['rm', '-f', ...containerIds], { stdio: 'pipe' });
        cleanupCmd.on('close', () => {
          console.log(chalk.green('✅ Contenedores anteriores limpiados'));
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// Preparar WordPress usando contenedor temporal
async function prepareWordPressWithDocker(spinner, port) {
  // Si WordPress no existe, descargarlo
  if (!fs.existsSync('./wordpress')) {
    spinner.stop(); // Detener spinner para mostrar progreso de descarga
    console.log(chalk.yellow('📦 WordPress no encontrado, descargando...'));
    await downloadWordPressWithNodeJS(); // Usar Node.js en lugar de Docker
    spinner.start(); // Reiniciar spinner
  } else {
    spinner.text = 'WordPress ya existe, saltando descarga...';
  }

  // Crear wp-config.php
  spinner.text = 'Creando configuración...';
  await createWordPressConfig(port, null);

  // Configurar wp-content
  spinner.text = 'Configurando wp-content...';
  await setupCustomContent();
}

// Descargar WordPress con Node.js (más confiable y con progreso)
// Descargar WordPress con Node.js (más confiable y con progreso)
async function downloadWordPressWithNodeJS() {
  const AdmZip = require('adm-zip');

  return new Promise((resolve, reject) => {
    console.log(chalk.blue('📥 Descargando WordPress...'));

    const file = fs.createWriteStream('./wordpress.zip');
    const request = https.get('https://wordpress.org/latest.zip', (response) => {
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      let lastPercent = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const percentage = Math.floor((downloadedSize / totalSize) * 100);

        // Mostrar progreso cada 5%
        if (percentage >= lastPercent + 5) {
          lastPercent = percentage;
          process.stdout.write(`\r📦 Descargando WordPress: ${percentage}%`);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(chalk.green('\n✅ Descarga completada'));
        console.log(chalk.blue('📂 Extrayendo archivos...'));

        try {
          const zip = new AdmZip('./wordpress.zip');
          const entries = zip.getEntries();
          const totalEntries = entries.length;

          console.log(chalk.blue(`📁 Extrayendo ${totalEntries} archivos...`));

          // CORRECCIÓN: Extraer todo de una vez
          zip.extractAllTo('./', true);

          console.log(chalk.green('\n✅ Extracción completada'));
          console.log(chalk.blue('🧹 Limpiando archivos temporales...'));
          fs.unlinkSync('./wordpress.zip');

          // VERIFICAR que WordPress se extrajo correctamente
          if (fs.existsSync('./wordpress/wp-config-sample.php')) {
            console.log(chalk.green('✅ WordPress extraído correctamente'));
            resolve();
          } else {
            reject(new Error('WordPress no se extrajo correctamente - archivo wp-config-sample.php no encontrado'));
          }

        } catch (error) {
          reject(new Error(`Error extrayendo WordPress: ${error.message}`));
        }
      });
    });

    request.on('error', (error) => {
      reject(new Error(`Error descargando WordPress: ${error.message}`));
    });

    request.setTimeout(600000, () => { // 10 minutos timeout
      request.destroy();
      reject(new Error('Timeout descargando WordPress'));
    });
  });
}

// Crear configuración de WordPress con soporte para URLs múltiples
async function createWordPressConfig(port, ngrokUrl = null) {
  const configPath = path.join(process.cwd(), 'wpsite.config.js');

  if (!fs.existsSync(configPath)) {
    throw new Error('wpsite.config.js no encontrado');
  }

  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);

  const wpConfig = `<?php
/**
 * WordPress Configuration - Desarrollo con Docker
 * Soporte para URLs múltiples (localhost + ngrok)
 */

// === CONFIGURACIÓN DE BASE DE DATOS ===
define('DB_NAME', '${config.database.name}');
define('DB_USER', '${config.database.user}');
define('DB_PASSWORD', '${config.database.password}');
define('DB_HOST', '${config.database.host}');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

// === URLs DINÁMICAS - DETECCIÓN AUTOMÁTICA ===
${ngrokUrl ? `
// URLs dinámicas - funciona con localhost Y ngrok
if (isset($_SERVER['HTTP_HOST'])) {
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || $_SERVER['SERVER_PORT'] == 443 ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'];
    $base_url = $protocol . '://' . $host;
    
    define('WP_HOME', $base_url);
    define('WP_SITEURL', $base_url);
} else {
    // Fallback
    define('WP_HOME', 'http://localhost:${port}');
    define('WP_SITEURL', 'http://localhost:${port}');
}

// Headers para túneles
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}
if (isset($_SERVER['HTTP_X_FORWARDED_HOST'])) {
    $_SERVER['HTTP_HOST'] = $_SERVER['HTTP_X_FORWARDED_HOST'];
}
` : `
// Configuración solo localhost
define('WP_HOME', 'http://localhost:${port}');
define('WP_SITEURL', 'http://localhost:${port}');
`}

// === CONFIGURACIÓN DE DEBUG ===
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);
define('SCRIPT_DEBUG', true);

// === CONFIGURACIÓN ADICIONAL ===
define('WP_AUTO_UPDATE_CORE', false);
define('DISALLOW_FILE_EDIT', true);
define('WP_POST_REVISIONS', 3);
define('AUTOMATIC_UPDATER_DISABLED', true);

// === CLAVES DE SEGURIDAD ===
define('AUTH_KEY',         'docker-dev-auth-key-' . time());
define('SECURE_AUTH_KEY',  'docker-dev-secure-auth-key-' . time());
define('LOGGED_IN_KEY',    'docker-dev-logged-in-key-' . time());
define('NONCE_KEY',        'docker-dev-nonce-key-' . time());
define('AUTH_SALT',        'docker-dev-auth-salt-' . time());
define('SECURE_AUTH_SALT', 'docker-dev-secure-auth-salt-' . time());
define('LOGGED_IN_SALT',   'docker-dev-logged-in-salt-' . time());
define('NONCE_SALT',       'docker-dev-nonce-salt-' . time());

\$table_prefix = '${config.database.tablePrefix || 'wp_'}';

if (!defined('ABSPATH')) {
    define('ABSPATH', dirname(__FILE__) . '/');
}

require_once ABSPATH . 'wp-settings.php';
`;

  const wpConfigPath = './wordpress/wp-config.php';
  if (fs.existsSync(wpConfigPath)) {
    fs.unlinkSync(wpConfigPath);
  }

  fs.writeFileSync(wpConfigPath, wpConfig);
}

// Configurar wp-content personalizado con sincronización automática
async function setupCustomContent() {
  const wpContentPath = './wordpress/wp-content';
  const sourceContentPath = './wp-content';

  console.log(chalk.blue('🔗 Configurando wp-content personalizado...'));

  // Hacer backup del wp-content original si existe
  if (fs.existsSync(wpContentPath)) {
    const backupPath = './wordpress/wp-content-original';
    if (!fs.existsSync(backupPath)) {
      console.log(chalk.yellow('💾 Haciendo backup del wp-content original...'));
      fs.renameSync(wpContentPath, backupPath);
    } else {
      fs.rmSync(wpContentPath, { recursive: true, force: true });
    }
  }

  // En Windows con Docker, copiar inicialmente
  if (process.platform === 'win32') {
    console.log(chalk.blue('💻 Windows detectado - copiando wp-content...'));
    fs.cpSync(sourceContentPath, wpContentPath, { recursive: true });

    // Configurar watch para sincronización automática
    setupFileWatcher(sourceContentPath, wpContentPath);
  } else {
    // En Mac/Linux usar symlink
    console.log(chalk.blue('🔗 Creando symlink para wp-content...'));
    const absoluteWpContent = path.resolve(sourceContentPath);
    fs.symlinkSync(absoluteWpContent, wpContentPath);
  }

  // Verificar que se configuró correctamente
  if (fs.existsSync(wpContentPath + '/themes')) {
    console.log(chalk.green('✅ wp-content configurado correctamente'));
  } else {
    throw new Error('wp-content no se configuró correctamente');
  }
}

// Configurar watcher para sincronizar cambios automáticamente
function setupFileWatcher(sourcePath, targetPath) {
  const chokidar = require('chokidar');

  console.log(chalk.blue('👀 Configurando sincronización automática de archivos...'));

  const watcher = chokidar.watch(sourcePath, {
    ignored: /node_modules/,
    persistent: true,
    ignoreInitial: true
  });

  watcher
    .on('change', (filePath) => {
      const relativePath = path.relative(sourcePath, filePath);
      const targetFile = path.join(targetPath, relativePath);

      try {
        fs.copyFileSync(filePath, targetFile);
        console.log(chalk.green(`🔄 Actualizado: ${relativePath}`));
      } catch (error) {
        console.log(chalk.red(`❌ Error actualizando ${relativePath}: ${error.message}`));
      }
    })
    .on('add', (filePath) => {
      const relativePath = path.relative(sourcePath, filePath);
      const targetFile = path.join(targetPath, relativePath);

      try {
        // Crear directorio si no existe
        const targetDir = path.dirname(targetFile);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.copyFileSync(filePath, targetFile);
        console.log(chalk.green(`➕ Agregado: ${relativePath}`));
      } catch (error) {
        console.log(chalk.red(`❌ Error agregando ${relativePath}: ${error.message}`));
      }
    })
    .on('unlink', (filePath) => {
      const relativePath = path.relative(sourcePath, filePath);
      const targetFile = path.join(targetPath, relativePath);

      try {
        if (fs.existsSync(targetFile)) {
          fs.unlinkSync(targetFile);
          console.log(chalk.yellow(`🗑️ Eliminado: ${relativePath}`));
        }
      } catch (error) {
        console.log(chalk.red(`❌ Error eliminando ${relativePath}: ${error.message}`));
      }
    });

  console.log(chalk.green('✅ Sincronización automática configurada'));
}

// Iniciar contenedor Docker principal
async function startDockerContainer(spinner, port) {
  spinner.text = 'Iniciando contenedor Docker...';

  return new Promise((resolve, reject) => {
    const containerName = `wpsite-dev-${port}`;

    // Función para limpiar contenedores existentes
    const cleanupExistingContainer = () => {
      return new Promise((resolveCleanup) => {
        // Intentar detener el contenedor si está corriendo
        exec(`docker stop ${containerName} 2>/dev/null`, () => {
          // Luego remover el contenedor
          exec(`docker rm ${containerName} 2>/dev/null`, () => {
            resolveCleanup();
          });
        });
      });
    };

    // Limpiar contenedor existente antes de crear uno nuevo
    cleanupExistingContainer().then(() => {
      console.log(chalk.blue('🧹 Limpiando contenedores existentes...'));

      // Iniciar nuevo contenedor con imagen que incluye MySQL
      const dockerArgs = [
        'run', '-d',
        '--name', containerName,
        '--rm', // Importante: auto-remover cuando se detenga
        '-p', `${port}:80`,
        '-v', `${process.cwd()}/wordpress:/var/www/html`,
        'wordpress:6.4-php8.2-apache'
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
          console.log(chalk.blue(`🐳 Contenedor iniciado: ${containerId.substring(0, 12)}`));
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
    let attempts = 0;
    const maxAttempts = 30; // 30 segundos max

    const checkWordPress = () => {
      attempts++;

      exec(`curl -f -s http://localhost:${port} >/dev/null 2>&1`, (error) => {
        if (error) {
          if (attempts >= maxAttempts) {
            console.log(chalk.yellow('\n⚠️ WordPress tardó más de lo esperado, pero continuando...'));
            resolve();
          } else {
            spinner.text = `Esperando WordPress... (${attempts}/${maxAttempts})`;
            setTimeout(checkWordPress, 1000);
          }
        } else {
          console.log(chalk.green('\n✅ WordPress está respondiendo'));
          resolve();
        }
      });
    };

    setTimeout(checkWordPress, 3000); // Esperar 3 segundos antes del primer check
  });
}

// Detener contenedor Docker mejorado
async function stopDockerContainer(containerId) {
  return new Promise((resolve) => {
    console.log(chalk.yellow('🛑 Deteniendo contenedor...'));

    // Intentar detener gracefully primero
    const stopCmd = spawn('docker', ['stop', '-t', '10', containerId], { stdio: 'pipe' });

    stopCmd.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('✅ Contenedor detenido'));
      } else {
        console.log(chalk.yellow('⚠️ Forzando detención del contenedor...'));
        // Si no se puede detener gracefully, forzar
        const killCmd = spawn('docker', ['kill', containerId], { stdio: 'pipe' });
        killCmd.on('close', () => {
          console.log(chalk.green('✅ Contenedor forzado a detenerse'));
        });
      }

      // Limpiar contenedor (si no tiene --rm)
      setTimeout(() => {
        const removeCmd = spawn('docker', ['rm', '-f', containerId], { stdio: 'pipe' });
        removeCmd.on('close', () => {
          resolve();
        });
      }, 1000);
    });
  });
}

// Función para actualizar wp-config con URL de ngrok
async function updateWordPressConfigForNgrok(ngrokUrl, port) {
  console.log(chalk.blue('🔄 Actualizando configuración de WordPress para túnel...'));

  try {
    await createWordPressConfig(port, ngrokUrl);

    // Copiar configuración actualizada al contenedor
    await new Promise((resolve, reject) => {
      exec('docker cp ./wordpress/wp-config.php wpsite-dev-' + port + ':/var/www/html/wp-config.php', (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(chalk.green('✅ Configuración actualizada en contenedor'));
          resolve();
        }
      });
    });

  } catch (error) {
    throw new Error(`Error actualizando configuración: ${error.message}`);
  }
}

// Función para iniciar túnel ngrok
async function startNgrokTunnel(port, spinner) {
  return new Promise((resolve, reject) => {
    spinner.text = 'Iniciando túnel ngrok...';

    // Verificar si ngrok está instalado
    exec('ngrok version', (versionError) => {
      if (versionError) {
        spinner.fail('❌ ngrok no está instalado');
        console.log(chalk.yellow('\n📦 Para usar túneles, instala ngrok:'));
        console.log(chalk.blue('   1. Descarga: https://ngrok.com/download'));
        console.log(chalk.blue('   2. O instala: npm install -g ngrok'));
        console.log(chalk.blue('   3. Configura: ngrok config add-authtoken TU_TOKEN'));
        reject(new Error('ngrok no encontrado'));
        return;
      }

      // Iniciar túnel ngrok
      const ngrokProcess = spawn('ngrok', ['http', port, '--host-header=rewrite'], { 
  stdio: 'pipe',
  detached: false 
});

      let ngrokUrl = null;
      let attempts = 0;
      const maxAttempts = 15;

      // Función para obtener la URL del túnel
      const checkNgrokUrl = () => {
        attempts++;

        exec('curl -s http://localhost:4040/api/tunnels', (error, stdout) => {
          if (error) {
            if (attempts < maxAttempts) {
              setTimeout(checkNgrokUrl, 1000);
            } else {
              reject(new Error('No se pudo obtener URL de ngrok'));
            }
            return;
          }

          try {
            const tunnels = JSON.parse(stdout);
            if (tunnels.tunnels && tunnels.tunnels.length > 0) {
              // Preferir HTTPS si está disponible
              const httpsTunnel = tunnels.tunnels.find(t => t.public_url.startsWith('https://'));
              ngrokUrl = httpsTunnel ? httpsTunnel.public_url : tunnels.tunnels[0].public_url;

              console.log(chalk.blue(`🔗 Túnel obtenido: ${ngrokUrl}`));

              resolve({
                url: ngrokUrl,
                process: ngrokProcess
              });
            } else {
              if (attempts < maxAttempts) {
                setTimeout(checkNgrokUrl, 1000);
              } else {
                reject(new Error('No se encontraron túneles activos'));
              }
            }
          } catch (parseError) {
            if (attempts < maxAttempts) {
              setTimeout(checkNgrokUrl, 1000);
            } else {
              reject(new Error('Error parseando respuesta de ngrok'));
            }
          }
        });
      };

      ngrokProcess.on('error', (error) => {
        reject(new Error(`Error iniciando ngrok: ${error.message}`));
      });

      ngrokProcess.stderr.on('data', (data) => {
        const errorMsg = data.toString();
        if (errorMsg.includes('authtoken')) {
          reject(new Error('Token de ngrok no configurado. Ejecuta: ngrok config add-authtoken TU_TOKEN'));
        }
      });

      setTimeout(checkNgrokUrl, 3000);
    });
  });
}

// Función para detener túnel ngrok
async function stopNgrokTunnel(ngrokProcess) {
  if (ngrokProcess && !ngrokProcess.killed) {
    console.log(chalk.yellow('🔌 Cerrando túnel ngrok...'));
    ngrokProcess.kill('SIGTERM');

    // Esperar un momento para que se cierre gracefully
    setTimeout(() => {
      if (!ngrokProcess.killed) {
        ngrokProcess.kill('SIGKILL');
      }
    }, 2000);
  }
}