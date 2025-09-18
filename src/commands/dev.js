const { spawn, exec } = require("child_process");
const chalk = require("chalk");
const ora = require("ora");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const DockerHelper = require("../utils/docker-helper");

// Clase para gestionar sincronización inteligente
class SyncManager {
  constructor(sourcePath, targetPath) {
    this.sourcePath = sourcePath;
    this.targetPath = targetPath;
    this.fileHashes = new Map(); // archivo -> hash
    this.syncingFiles = new Set(); // archivos en proceso
    this.pendingOperations = new Map(); // archivo -> timeout
    this.lastSyncTime = new Map(); // archivo -> timestamp
    this.recentlySynced = new Set(); // archivos sincronizados recientemente
  }

  // Calcular hash del archivo
  getFileHash(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath);
      return crypto.createHash("md5").update(content).digest("hex");
    } catch (error) {
      return null;
    }
  }

  // Verificar si realmente cambió
  hasFileChanged(filePath) {
    const currentHash = this.getFileHash(filePath);
    const storedHash = this.fileHashes.get(filePath);
    return currentHash !== storedHash && currentHash !== null;
  }

  // Marcar archivo como sincronizándose
  lockFile(filePath) {
    this.syncingFiles.add(filePath);
    this.recentlySynced.add(filePath);
    
    // Auto-unlock después de 10 segundos como seguridad
    setTimeout(() => {
      this.unlockFile(filePath);
    }, 10000);
  }

  // Liberar archivo
  unlockFile(filePath) {
    this.syncingFiles.delete(filePath);
    
    // Mantener en recentlySynced por más tiempo para evitar loops
    setTimeout(() => {
      this.recentlySynced.delete(filePath);
    }, 5000);
  }

  // Verificar si está siendo sincronizado o fue sincronizado recientemente
  isFileLocked(filePath) {
    return this.syncingFiles.has(filePath) || this.recentlySynced.has(filePath);
  }

  // Actualizar hash después de sincronización para ambos archivos
  updateFileHash(filePath) {
    const hash = this.getFileHash(filePath);
    if (hash) {
      this.fileHashes.set(filePath, hash);
      this.lastSyncTime.set(filePath, Date.now());
    }
  }

  // Actualizar hashes para archivos relacionados (origen y destino)
  updateRelatedHashes(sourcePath, targetPath) {
    const sourceHash = this.getFileHash(sourcePath);
    const targetHash = this.getFileHash(targetPath);
    
    if (sourceHash && targetHash && sourceHash === targetHash) {
      this.fileHashes.set(sourcePath, sourceHash);
      this.fileHashes.set(targetPath, targetHash);
      this.lastSyncTime.set(sourcePath, Date.now());
      this.lastSyncTime.set(targetPath, Date.now());
    }
  }

  // Verificar si el archivo fue modificado recientemente
  wasRecentlyModified(filePath, thresholdMs = 3000) {
    const lastSync = this.lastSyncTime.get(filePath);
    return lastSync && (Date.now() - lastSync < thresholdMs);
  }

  // Limpiar operaciones pendientes
  cleanup() {
    this.pendingOperations.forEach((timeout) => clearTimeout(timeout));
    this.pendingOperations.clear();
    this.syncingFiles.clear();
    this.recentlySynced.clear();
  }
}

module.exports = async (options = {}) => {
  const spinner = ora("Iniciando WordPress...").start();
  const port = options.port || 8080;
  const useTunnel = options.tunel || options.tunnel;

  let ngrokTunnel = null;

  try {
    // 1. Verificar Docker (única dependencia)
    await checkDockerRequirement(spinner);

    // 2. Verificar wp-content
    if (!fs.existsSync("./wp-content")) {
      spinner.fail("❌ No se encontró wp-content/");
      console.log(
        chalk.yellow(
          "Asegúrate de estar en un directorio con wp-content/ clonado desde GitHub"
        )
      );
      console.log(chalk.blue("Ejemplo:"));
      console.log(chalk.blue("  git clone tu-repo.git ."));
      console.log(chalk.blue("  wpsite dev"));
      return;
    }

    // 3. Verificar configuración
    if (!fs.existsSync("./wpsite.config.js")) {
      spinner.fail("❌ No se encontró wpsite.config.js");
      console.log(chalk.yellow("Ejecuta: wpsite init"));
      return;
    }

    // 4. Limpiar contenedores existentes de wpsite
    await cleanupAllWPSiteContainers(spinner);

    // 5. Verificar que el puerto esté disponible
    const isPortAvailable = await DockerHelper.checkPortAvailable(port);
    if (!isPortAvailable) {
      spinner.fail(`❌ El puerto ${port} ya está en uso`);
      console.log(
        chalk.yellow(
          `Prueba con otro puerto: wpsite dev --port ${parseInt(port) + 1}`
        )
      );
      return;
    }

    // 6. Preparar WordPress y configuración
    await prepareWordPressWithDocker(spinner, port);

    // 7. Iniciar contenedor Docker
    const containerId = await startDockerContainer(spinner, port);

    // 8. Esperar a que WordPress esté listo
    await waitForWordPress(spinner, port);

    // 9. Iniciar túnel ngrok si se solicita
    if (useTunnel) {
      try {
        ngrokTunnel = await startNgrokTunnel(port, spinner);
      } catch (error) {
        console.log(
          chalk.yellow(`⚠️ No se pudo iniciar túnel: ${error.message}`)
        );
        console.log(chalk.blue("   Continuando sin túnel..."));
      }
    }

    // 10. Mostrar información
    spinner.succeed(
      `🚀 WordPress corriendo en ${chalk.green(`http://localhost:${port}`)}`
    );
    console.log(chalk.blue("🐳 Servidor: Docker (wpsite-wordpress:latest)"));
    console.log(chalk.blue("📁 wp-content: Local (desde GitHub)"));
    console.log(chalk.blue("🗃️ Base de datos: Remota"));
    console.log(
      chalk.magenta(`📋 Container ID: ${containerId.substring(0, 12)}`)
    );

    if (ngrokTunnel && ngrokTunnel.url) {
      console.log(chalk.magenta(`🌍 Túnel público: ${ngrokTunnel.url}`));
      console.log(
        chalk.yellow("💡 Comparte esta URL con otros desarrolladores")
      );
    }

    console.log(chalk.yellow("\n✨ Presiona Ctrl+C para detener\n"));

    // 11. Cleanup al cerrar
    process.on("SIGINT", async () => {
      console.log(chalk.red("\n🛑 Deteniendo servicios..."));

      // Cerrar watchers si existen
      if (global.wpContentSyncManager) {
        global.wpContentSyncManager.cleanup();
        if (global.wpContentWatcher) {
          global.wpContentWatcher.close();
        }
        console.log(chalk.yellow("📂 Sincronización de archivos detenida"));
      }

      // Detener túnel primero
      if (ngrokTunnel && ngrokTunnel.process) {
        await stopNgrokTunnel(ngrokTunnel.process);
      }

      // Luego detener contenedor
      await stopDockerContainer(containerId);
      console.log(chalk.green("✅ Servicios detenidos correctamente"));
      process.exit(0);
    });

    // 12. Mantener el proceso vivo
    process.stdin.resume();
  } catch (error) {
    spinner.fail(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

// Verificar que Docker esté disponible
async function checkDockerRequirement(spinner) {
  spinner.text = "Verificando Docker...";

  return new Promise((resolve, reject) => {
    exec("docker --version", (error, stdout) => {
      if (error) {
        spinner.fail("❌ Docker no está instalado");
        console.log(
          chalk.yellow("\n📦 wpsite requiere Docker para funcionar:")
        );
        console.log(
          chalk.blue(
            "   Windows: https://docs.docker.com/desktop/windows/install/"
          )
        );
        console.log(
          chalk.blue("   Mac: https://docs.docker.com/desktop/mac/install/")
        );
        console.log(
          chalk.blue("   Linux: https://docs.docker.com/engine/install/")
        );
        console.log(
          chalk.yellow(
            "\n🔄 Después de instalar Docker, reinicia y vuelve a intentar"
          )
        );
        reject(new Error("Docker no encontrado"));
        return;
      }

      // Verificar que Docker esté corriendo
      exec("docker info", (infoError) => {
        if (infoError) {
          spinner.fail("❌ Docker no está corriendo");
          console.log(
            chalk.yellow("\n🔄 Inicia Docker Desktop y vuelve a intentar")
          );
          reject(new Error("Docker no está corriendo"));
          return;
        }

        const version = stdout.trim().replace("Docker version ", "");
        spinner.text = `Docker encontrado: ${version}`;
        resolve();
      });
    });
  });
}

// Limpiar todos los contenedores wpsite existentes
async function cleanupAllWPSiteContainers(spinner) {
  spinner.text = "Limpiando contenedores anteriores...";

  return new Promise((resolve) => {
    exec('docker ps -aq --filter "name=wpsite-dev"', (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve();
        return;
      }

      const containerIds = stdout
        .trim()
        .split("\n")
        .filter((id) => id);

      if (containerIds.length > 0) {
        console.log(
          chalk.yellow(
            `🧹 Encontrados ${containerIds.length} contenedores wpsite, limpiando...`
          )
        );

        const cleanupCmd = spawn("docker", ["rm", "-f", ...containerIds], {
          stdio: "pipe",
        });
        cleanupCmd.on("close", () => {
          console.log(chalk.green("✅ Contenedores anteriores limpiados"));
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
  if (!fs.existsSync("./wordpress")) {
    spinner.stop();
    console.log(chalk.yellow("📦 WordPress no encontrado, descargando..."));
    await downloadWordPressWithNodeJS();
    spinner.start();
  } else {
    spinner.text = "WordPress ya existe, saltando descarga...";
  }

  spinner.text = "Creando configuración...";
  await createWordPressConfig(port, null);

  spinner.text = "Configurando wp-content...";
  await setupCustomContent();
}

// Descargar WordPress con Node.js (más confiable y con progreso)
async function downloadWordPressWithNodeJS() {
  const AdmZip = require("adm-zip");

  return new Promise((resolve, reject) => {
    console.log(chalk.blue("📥 Descargando WordPress..."));

    const file = fs.createWriteStream("./wordpress.zip");
    const request = https.get(
      "https://wordpress.org/latest.zip",
      (response) => {
        const totalSize = parseInt(response.headers["content-length"], 10);
        let downloadedSize = 0;
        let lastPercent = 0;

        response.on("data", (chunk) => {
          downloadedSize += chunk.length;
          const percentage = Math.floor((downloadedSize / totalSize) * 100);

          if (percentage >= lastPercent + 5) {
            lastPercent = percentage;
            process.stdout.write(`\r📦 Descargando WordPress: ${percentage}%`);
          }
        });

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          console.log(chalk.green("\n✅ Descarga completada"));
          console.log(chalk.blue("📂 Extrayendo archivos..."));

          try {
            const zip = new AdmZip("./wordpress.zip");
            zip.extractAllTo("./", true);

            console.log(chalk.green("\n✅ Extracción completada"));
            console.log(chalk.blue("🧹 Limpiando archivos temporales..."));
            fs.unlinkSync("./wordpress.zip");

            if (fs.existsSync("./wordpress/wp-config-sample.php")) {
              console.log(chalk.green("✅ WordPress extraído correctamente"));
              resolve();
            } else {
              reject(new Error("WordPress no se extrajo correctamente"));
            }
          } catch (error) {
            reject(new Error(`Error extrayendo WordPress: ${error.message}`));
          }
        });
      }
    );

    request.on("error", (error) => {
      reject(new Error(`Error descargando WordPress: ${error.message}`));
    });

    request.setTimeout(600000, () => {
      request.destroy();
      reject(new Error("Timeout descargando WordPress"));
    });
  });
}

// Crear configuración de WordPress con URLs fijas para evitar problemas de sesión
async function createWordPressConfig(port, ngrokUrl = null) {
  const configPath = path.join(process.cwd(), "wpsite.config.js");

  if (!fs.existsSync(configPath)) {
    throw new Error("wpsite.config.js no encontrado");
  }

  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);

  const primaryUrl = ngrokUrl || `http://localhost:${port}`;

  const wpConfig = `<?php
/**
 * WordPress Configuration - URLs fijas para evitar problemas de sesión
 */

// === CONFIGURACIÓN DE BASE DE DATOS ===
define('DB_NAME', '${config.database.name}');
define('DB_USER', '${config.database.user}');
define('DB_PASSWORD', '${config.database.password}');
define('DB_HOST', '${config.database.host}');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

// === URLs FIJAS ===
define('WP_HOME', '${primaryUrl}');
define('WP_SITEURL', '${primaryUrl}');

// === CONFIGURACIÓN PARA TÚNELES ===
${
  ngrokUrl
    ? `
// Headers para ngrok
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}

// Forzar cookies para ngrok
define('COOKIE_DOMAIN', '');
define('COOKIEPATH', '/');
define('SITECOOKIEPATH', '/');
define('ADMIN_COOKIE_PATH', '/');
define('PLUGINS_COOKIE_PATH', '/');

// Configuración de sesión para ngrok
ini_set('session.cookie_secure', false);
ini_set('session.cookie_samesite', 'Lax');
`
    : `
// Configuración para localhost
define('COOKIE_DOMAIN', '');
define('COOKIEPATH', '/');
define('SITECOOKIEPATH', '/');
`
}

// === DESACTIVAR VALIDACIONES ESTRICTAS ===
define('RELOCATE', true);

// === CONFIGURACIÓN DE SESIONES ===
ini_set('session.cookie_httponly', 1);
ini_set('session.use_only_cookies', 1);
ini_set('session.cookie_lifetime', 0);
ini_set('session.gc_maxlifetime', 3600);

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
define('WP_MEMORY_LIMIT', '256M');

// === CLAVES DE SEGURIDAD FIJAS ===
define('AUTH_KEY',         'wpsite-dev-auth-key-12345');
define('SECURE_AUTH_KEY',  'wpsite-dev-secure-auth-key-12345');
define('LOGGED_IN_KEY',    'wpsite-dev-logged-in-key-12345');
define('NONCE_KEY',        'wpsite-dev-nonce-key-12345');
define('AUTH_SALT',        'wpsite-dev-auth-salt-12345');
define('SECURE_AUTH_SALT', 'wpsite-dev-secure-auth-salt-12345');
define('LOGGED_IN_SALT',   'wpsite-dev-logged-in-salt-12345');
define('NONCE_SALT',       'wpsite-dev-nonce-salt-12345');

\$table_prefix = '${config.database.tablePrefix || "wp_"}';

if (!defined('ABSPATH')) {
    define('ABSPATH', dirname(__FILE__) . '/');
}

require_once ABSPATH . 'wp-settings.php';
`;

  const wpConfigPath = "./wordpress/wp-config.php";
  if (fs.existsSync(wpConfigPath)) {
    fs.unlinkSync(wpConfigPath);
  }

  fs.writeFileSync(wpConfigPath, wpConfig);
}

// Configurar wp-content con sincronización inteligente CORREGIDA
async function setupCustomContent() {
  const wpContentPath = "./wordpress/wp-content";
  const sourceContentPath = "./wp-content";

  console.log(chalk.blue("🔗 Configurando wp-content personalizado..."));

  if (fs.existsSync(wpContentPath)) {
    const backupPath = "./wordpress/wp-content-original";
    if (!fs.existsSync(backupPath)) {
      console.log(
        chalk.yellow("💾 Haciendo backup del wp-content original...")
      );
      fs.renameSync(wpContentPath, backupPath);
    } else {
      fs.rmSync(wpContentPath, { recursive: true, force: true });
    }
  }

  console.log(chalk.blue("📁 Copiando wp-content..."));
  fs.cpSync(sourceContentPath, wpContentPath, { recursive: true });

  // Configurar sincronización inteligente CORREGIDA
  const { watcher, syncManager } = setupUnifiedWatcher(
    path.resolve(process.cwd(), "wp-content"), // Ruta absoluta completa
    path.resolve(process.cwd(), "wordpress/wp-content") // Ruta absoluta completa
  );

  // Guardar referencias globales para cleanup
  global.wpContentWatcher = watcher;
  global.wpContentSyncManager = syncManager;

  if (fs.existsSync(wpContentPath + "/themes")) {
    console.log(chalk.green("✅ wp-content configurado correctamente"));
    console.log(chalk.blue("👀 Sincronización inteligente activada"));
  } else {
    throw new Error("wp-content no se configuró correctamente");
  }
}

// Sistema de sincronización unificado e inteligente CORREGIDO
function setupUnifiedWatcher(sourcePath, targetPath) {
  const chokidar = require("chokidar");
  const syncManager = new SyncManager(sourcePath, targetPath);

  // Inicializar hashes de archivos existentes
  initializeFileHashes(syncManager);

  const watcher = chokidar.watch([sourcePath, targetPath], {
    ignored: [
      /node_modules/,
      /wp-content-original/,
      /wp-content-backup/,
      /\.git/,
      /\.DS_Store/,
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,  // Esperar 1 segundo de estabilidad
      pollInterval: 100
    },
  });

  watcher.on("change", (filePath) => {
    handleFileChange(filePath, syncManager);
  });

  watcher.on("add", (filePath) => {
    handleFileChange(filePath, syncManager);
  });

  return { watcher, syncManager };
}

// Manejar cambios de archivos CORREGIDO
function handleFileChange(filePath, syncManager) {
  // Normalizar path para comparación
  const normalizedPath = path.resolve(filePath);
  
  // Evitar loops: si el archivo está siendo sincronizado o fue sincronizado recientemente
  if (syncManager.isFileLocked(normalizedPath)) {
    return;
  }

  // Verificar si fue modificado muy recientemente por otra sincronización
  if (syncManager.wasRecentlyModified(normalizedPath, 3000)) {
    return;
  }

  // Verificar si realmente cambió el contenido
  if (!syncManager.hasFileChanged(normalizedPath)) {
    return;
  }

  // Determinar dirección del cambio
  const isSourceFile = normalizedPath.startsWith(syncManager.sourcePath);
  const direction = isSourceFile ? "source-to-target" : "target-to-source";

  // Programar sincronización
  scheduleSync(normalizedPath, direction, syncManager);
}

// Programar sincronización con debounce MEJORADO
function scheduleSync(filePath, direction, syncManager) {
  const key = `${filePath}-${direction}`;

  // Cancelar operación pendiente si existe
  if (syncManager.pendingOperations.has(key)) {
    clearTimeout(syncManager.pendingOperations.get(key));
  }

  // Delay más largo para archivos del contenedor hacia local
  const delay = direction === "target-to-source" ? 4000 : 2000;

  const timeout = setTimeout(() => {
    performSync(filePath, direction, syncManager);
    syncManager.pendingOperations.delete(key);
  }, delay);

  syncManager.pendingOperations.set(key, timeout);
}

// Ejecutar sincronización COMPLETAMENTE CORREGIDO
async function performSync(filePath, direction, syncManager) {
  // Normalizar path al inicio
  const normalizedFilePath = path.resolve(filePath);
  
  try {
    // Verificar nuevamente si está locked (doble verificación)
    if (syncManager.isFileLocked(normalizedFilePath)) {
      return;
    }

    // Lock el archivo
    syncManager.lockFile(normalizedFilePath);

    const { sourcePath, targetPath } = getSyncPaths(
      normalizedFilePath,
      direction,
      syncManager
    );

    // Verificar que el archivo origen existe y es estable
    if (!await isFileStable(sourcePath)) {
      return;
    }

    // Verificar que el contenido realmente cambió
    if (!syncManager.hasFileChanged(sourcePath)) {
      return;
    }

    // Crear directorio destino si no existe
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copiar archivo
    fs.copyFileSync(sourcePath, targetPath);

    // Actualizar hashes para ambos archivos
    syncManager.updateRelatedHashes(sourcePath, targetPath);

    // Log una sola vez con información clara
    const relativePath = path.relative(process.cwd(), sourcePath);
    const directionText =
      direction === "source-to-target"
        ? "Local→Contenedor"
        : "Contenedor→Local";
    console.log(chalk.green(`✓ ${directionText}: ${relativePath}`));
    
  } catch (error) {
    console.log(chalk.red(`Error en sync: ${error.message}`));
  } finally {
    // Liberar archivo después de un delay
    setTimeout(() => {
      syncManager.unlockFile(normalizedFilePath);
    }, 1000);
  }
}

// Verificar si un archivo está estable (no está siendo modificado)
async function isFileStable(filePath, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const stats1 = fs.statSync(filePath);
      if (stats1.size === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // Esperar un poco y verificar que no cambió
      await new Promise(resolve => setTimeout(resolve, 500));

      if (!fs.existsSync(filePath)) {
        return false;
      }

      const stats2 = fs.statSync(filePath);
      
      // Verificar que tamaño y fecha de modificación son iguales
      if (stats1.size === stats2.size && 
          stats1.mtime.getTime() === stats2.mtime.getTime()) {
        return true;
      }

    } catch (error) {
      // Si hay error, el archivo podría estar siendo modificado
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return false;
}

// Obtener rutas de origen y destino según la dirección COMPLETAMENTE CORREGIDO
function getSyncPaths(filePath, direction, syncManager) {
  const normalizedFilePath = path.resolve(filePath);
  const normalizedSourcePath = path.resolve(syncManager.sourcePath);
  const normalizedTargetPath = path.resolve(syncManager.targetPath);

  if (direction === "source-to-target") {
    // Local → Contenedor
    const relativePath = path.relative(normalizedSourcePath, normalizedFilePath);
    return {
      sourcePath: normalizedFilePath,
      targetPath: path.resolve(normalizedTargetPath, relativePath),
    };
  } else {
    // Contenedor → Local
    const relativePath = path.relative(normalizedTargetPath, normalizedFilePath);
    return {
      sourcePath: normalizedFilePath, // El archivo modificado en el contenedor
      targetPath: path.resolve(normalizedSourcePath, relativePath), // Su equivalente en local
    };
  }
}

// Inicializar hashes de archivos existentes
function initializeFileHashes(syncManager) {
  const getAllFiles = (dir) => {
    const files = [];
    if (!fs.existsSync(dir)) return files;

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory() && !item.name.startsWith(".")) {
          files.push(...getAllFiles(fullPath));
        } else if (item.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignorar errores de permisos
    }
    return files;
  };

  // Inicializar hashes de archivos existentes
  const sourceFiles = getAllFiles(syncManager.sourcePath);
  const targetFiles = getAllFiles(syncManager.targetPath);

  [...sourceFiles, ...targetFiles].forEach((file) => {
    syncManager.updateFileHash(file);
  });
}

// Construir imagen personalizada con Git
async function buildCustomImage(spinner) {
  return new Promise((resolve, reject) => {
    exec("docker images -q wpsite-wordpress:latest", (error, stdout) => {
      if (stdout.trim()) {
        resolve();
        return;
      }

      spinner.text = "Construyendo imagen Docker con Git...";

      // Encontrar la ruta del Dockerfile
      let dockerfilePath = path.join(process.cwd(), "Dockerfile");
      let contextPath = process.cwd();

      if (!fs.existsSync(dockerfilePath)) {
        const globalPath = path.join(__dirname, "../../../Dockerfile");
        if (fs.existsSync(globalPath)) {
          dockerfilePath = globalPath;
          contextPath = path.dirname(globalPath);
        }
      }

      // Crear Dockerfile si no existe
      if (!fs.existsSync(dockerfilePath)) {
        const dockerfileContent = `FROM wordpress:6.4-php8.2-apache

# Actualizar repositorios e instalar Git
RUN apt-get update && \\
    apt-get install -y git && \\
    apt-get clean && \\
    rm -rf /var/lib/apt/lists/*

EXPOSE 80
CMD ["apache2-foreground"]
`;
        fs.writeFileSync(dockerfilePath, dockerfileContent);
        console.log(chalk.blue("📝 Dockerfile creado"));
      }

      const buildCmd = spawn(
        "docker",
        [
          "build",
          "-t",
          "wpsite-wordpress:latest",
          "-f",
          dockerfilePath,
          contextPath,
        ],
        { stdio: "pipe" }
      );

      buildCmd.on("close", (code) => {
        if (code === 0) {
          console.log(chalk.green("✅ Imagen Docker construida con Git"));
          resolve();
        } else {
          reject(new Error("Error construyendo imagen Docker"));
        }
      });
    });
  });
}

// Iniciar contenedor Docker principal
async function startDockerContainer(spinner, port) {
  spinner.text = "Iniciando contenedor Docker...";

  return new Promise(async (resolve, reject) => {
    const containerName = `wpsite-dev-${port}`;

    try {
      // Construir imagen personalizada con Git
      await buildCustomImage(spinner);

      // Limpiar contenedor existente
      await cleanupExistingContainer(containerName);

      console.log(chalk.blue("🧹 Limpiando contenedores existentes..."));

      // Iniciar contenedor con imagen personalizada
      const dockerArgs = [
        "run",
        "-d",
        "--name",
        containerName,
        "--rm",
        "-p",
        `${port}:80`,
        "-v",
        `${process.cwd()}/wordpress:/var/www/html`,
        "wpsite-wordpress:latest",
      ];

      const containerStart = spawn("docker", dockerArgs, { stdio: "pipe" });

      let containerId = "";
      let errorOutput = "";

      containerStart.stdout.on("data", (data) => {
        containerId += data.toString().trim();
      });

      containerStart.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      containerStart.on("close", (code) => {
        if (code === 0 && containerId) {
          console.log(
            chalk.blue(
              `🐳 Contenedor iniciado: ${containerId.substring(0, 12)}`
            )
          );
          resolve(containerId);
        } else {
          reject(new Error(`Error iniciando contenedor: ${errorOutput}`));
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function cleanupExistingContainer(containerName) {
  return new Promise((resolve) => {
    exec(`docker stop ${containerName} 2>/dev/null`, () => {
      exec(`docker rm ${containerName} 2>/dev/null`, () => {
        resolve();
      });
    });
  });
}

// Esperar a que WordPress esté disponible
async function waitForWordPress(spinner, port) {
  spinner.text = "Esperando a que WordPress esté listo...";

  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 30;

    const checkWordPress = () => {
      attempts++;

      exec(`curl -f -s http://localhost:${port} >/dev/null 2>&1`, (error) => {
        if (error) {
          if (attempts >= maxAttempts) {
            console.log(
              chalk.yellow(
                "\n⚠️ WordPress tardó más de lo esperado, pero continuando..."
              )
            );
            resolve();
          } else {
            spinner.text = `Esperando WordPress... (${attempts}/${maxAttempts})`;
            setTimeout(checkWordPress, 1000);
          }
        } else {
          console.log(chalk.green("\n✅ WordPress está respondiendo"));
          resolve();
        }
      });
    };

    setTimeout(checkWordPress, 3000);
  });
}

// Función para iniciar túnel ngrok
async function startNgrokTunnel(port, spinner) {
  return new Promise((resolve, reject) => {
    spinner.text = "Iniciando túnel ngrok...";

    exec("ngrok version", (versionError) => {
      if (versionError) {
        spinner.fail("❌ ngrok no está instalado");
        console.log(chalk.yellow("\n📦 Para usar túneles, instala ngrok:"));
        console.log(chalk.blue("   1. Descarga: https://ngrok.com/download"));
        console.log(chalk.blue("   2. O instala: npm install -g ngrok"));
        console.log(
          chalk.blue("   3. Configura: ngrok config add-authtoken TU_TOKEN")
        );
        reject(new Error("ngrok no encontrado"));
        return;
      }

      const ngrokProcess = spawn(
        "ngrok",
        ["http", port, "--host-header=rewrite"],
        {
          stdio: "pipe",
          detached: false,
        }
      );

      let ngrokUrl = null;
      let attempts = 0;
      const maxAttempts = 15;

      const checkNgrokUrl = () => {
        attempts++;

        exec("curl -s http://localhost:4040/api/tunnels", (error, stdout) => {
          if (error) {
            if (attempts < maxAttempts) {
              setTimeout(checkNgrokUrl, 1000);
            } else {
              reject(new Error("No se pudo obtener URL de ngrok"));
            }
            return;
          }

          try {
            const tunnels = JSON.parse(stdout);
            if (tunnels.tunnels && tunnels.tunnels.length > 0) {
              const httpsTunnel = tunnels.tunnels.find((t) =>
                t.public_url.startsWith("https://")
              );
              ngrokUrl = httpsTunnel
                ? httpsTunnel.public_url
                : tunnels.tunnels[0].public_url;

              console.log(chalk.blue(`🔗 Túnel obtenido: ${ngrokUrl}`));

              resolve({
                url: ngrokUrl,
                process: ngrokProcess,
              });
            } else {
              if (attempts < maxAttempts) {
                setTimeout(checkNgrokUrl, 1000);
              } else {
                reject(new Error("No se encontraron túneles activos"));
              }
            }
          } catch (parseError) {
            if (attempts < maxAttempts) {
              setTimeout(checkNgrokUrl, 1000);
            } else {
              reject(new Error("Error parseando respuesta de ngrok"));
            }
          }
        });
      };

      ngrokProcess.on("error", (error) => {
        reject(new Error(`Error iniciando ngrok: ${error.message}`));
      });

      ngrokProcess.stderr.on("data", (data) => {
        const errorMsg = data.toString();
        if (errorMsg.includes("authtoken")) {
          reject(
            new Error(
              "Token de ngrok no configurado. Ejecuta: ngrok config add-authtoken TU_TOKEN"
            )
          );
        }
      });

      setTimeout(checkNgrokUrl, 3000);
    });
  });
}

// Función para detener túnel ngrok
async function stopNgrokTunnel(ngrokProcess) {
  if (ngrokProcess && !ngrokProcess.killed) {
    console.log(chalk.yellow("🔌 Cerrando túnel ngrok..."));
    ngrokProcess.kill("SIGTERM");

    setTimeout(() => {
      if (!ngrokProcess.killed) {
        ngrokProcess.kill("SIGKILL");
      }
    }, 2000);
  }
}

// Detener contenedor Docker mejorado
async function stopDockerContainer(containerId) {
  return new Promise((resolve) => {
    console.log(chalk.yellow("🛑 Deteniendo contenedor..."));

    const stopCmd = spawn("docker", ["stop", "-t", "10", containerId], {
      stdio: "pipe",
    });

    stopCmd.on("close", (code) => {
      if (code === 0) {
        console.log(chalk.green("✅ Contenedor detenido"));
      } else {
        console.log(chalk.yellow("⚠️ Forzando detención del contenedor..."));
        const killCmd = spawn("docker", ["kill", containerId], {
          stdio: "pipe",
        });
        killCmd.on("close", () => {
          console.log(chalk.green("✅ Contenedor forzado a detenerse"));
        });
      }

      setTimeout(() => {
        const removeCmd = spawn("docker", ["rm", "-f", containerId], {
          stdio: "pipe",
        });
        removeCmd.on("close", () => {
          resolve();
        });
      }, 1000);
    });
  });
}