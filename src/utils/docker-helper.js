const { exec, spawn } = require('child_process');
const net = require('net');
const chalk = require('chalk');

class DockerHelper {
  
  /**
   * Verificar si un puerto está disponible
   * @param {number} port - Puerto a verificar
   * @returns {Promise<boolean>} - true si está disponible, false si está ocupado
   */
  static async checkPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.once('close', () => {
          resolve(true);
        });
        server.close();
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Verificar si Docker está disponible y corriendo
   * @returns {Promise<boolean>} - true si Docker está disponible
   */
  static async checkDockerAvailable() {
    return new Promise((resolve) => {
      exec('docker info', (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Obtener información detallada de Docker
   * @returns {Promise<Object>} - Información de Docker o error
   */
  static async getDockerInfo() {
    return new Promise((resolve, reject) => {
      exec('docker version --format "{{.Server.Version}}"', (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            version: stdout.trim(),
            available: true
          });
        }
      });
    });
  }

  /**
   * Limpiar contenedores de wpsite
   * @param {string} pattern - Patrón de nombres a limpiar (opcional)
   * @returns {Promise<number>} - Número de contenedores limpiados
   */
  static async cleanupContainers(pattern = 'wpsite-dev-*') {
    return new Promise((resolve) => {
      exec('docker ps -aq --filter "name=wpsite-dev"', (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(0);
          return;
        }

        const containerIds = stdout.trim().split('\n').filter(id => id);
        
        if (containerIds.length > 0) {
          const cleanupCmd = spawn('docker', ['rm', '-f', ...containerIds], { stdio: 'pipe' });
          cleanupCmd.on('close', () => resolve(containerIds.length));
        } else {
          resolve(0);
        }
      });
    });
  }

  /**
   * Verificar si una imagen Docker existe localmente
   * @param {string} imageName - Nombre de la imagen a verificar
   * @returns {Promise<boolean>} - true si existe
   */
  static async checkImageExists(imageName) {
    return new Promise((resolve) => {
      exec(`docker images -q ${imageName}`, (error, stdout) => {
        resolve(!error && stdout.trim() !== '');
      });
    });
  }

  /**
   * Descargar imagen Docker si no existe
   * @param {string} imageName - Nombre de la imagen
   * @param {Object} spinner - Spinner para mostrar progreso (opcional)
   * @returns {Promise<void>}
   */
  static async pullImageIfNeeded(imageName, spinner) {
    const exists = await this.checkImageExists(imageName);
    
    if (!exists) {
      if (spinner) {
        spinner.text = `Descargando imagen Docker: ${imageName}...`;
      }
      
      return new Promise((resolve, reject) => {
        const pullCmd = spawn('docker', ['pull', imageName], { stdio: 'pipe' });
        
        pullCmd.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Error descargando imagen ${imageName}`));
          }
        });
      });
    }
  }

  /**
   * Obtener logs de un contenedor
   * @param {string} containerId - ID del contenedor
   * @param {number} lines - Número de líneas a obtener (por defecto 50)
   * @returns {Promise<Object>} - Logs stdout y stderr
   */
  static async getContainerLogs(containerId, lines = 50) {
    return new Promise((resolve, reject) => {
      exec(`docker logs --tail ${lines} ${containerId}`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim()
          });
        }
      });
    });
  }

  /**
   * Verificar si un contenedor está corriendo
   * @param {string} containerName - Nombre del contenedor
   * @returns {Promise<boolean>} - true si está corriendo
   */
  static async isContainerRunning(containerName) {
    return new Promise((resolve) => {
      exec(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`, (error, stdout) => {
        resolve(!error && stdout.trim() === containerName);
      });
    });
  }

  /**
   * Obtener estadísticas de un contenedor
   * @param {string} containerId - ID del contenedor
   * @returns {Promise<Object>} - Estadísticas del contenedor
   */
  static async getContainerStats(containerId) {
    return new Promise((resolve, reject) => {
      exec(`docker stats ${containerId} --no-stream --format "table {{.Container}}\\t{{.CPUPerc}}\\t{{.MemUsage}}"`, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          const lines = stdout.trim().split('\n');
          if (lines.length > 1) {
            const stats = lines[1].split('\t');
            resolve({
              container: stats[0],
              cpu: stats[1],
              memory: stats[2]
            });
          } else {
            resolve(null);
          }
        }
      });
    });
  }

  /**
   * Ejecutar comando dentro de un contenedor
   * @param {string} containerId - ID del contenedor
   * @param {string} command - Comando a ejecutar
   * @returns {Promise<string>} - Output del comando
   */
  static async execInContainer(containerId, command) {
    return new Promise((resolve, reject) => {
      const execCmd = spawn('docker', ['exec', containerId, 'sh', '-c', command], { stdio: 'pipe' });
      
      let output = '';
      let errorOutput = '';
      
      execCmd.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      execCmd.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      execCmd.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(errorOutput.trim() || 'Command failed'));
        }
      });
    });
  }

  /**
   * Crear red Docker si no existe
   * @param {string} networkName - Nombre de la red
   * @returns {Promise<void>}
   */
  static async ensureNetwork(networkName) {
    return new Promise((resolve) => {
      exec(`docker network ls --filter name=${networkName} --format "{{.Name}}"`, (error, stdout) => {
        if (error || stdout.trim() !== networkName) {
          // Crear red
          const createCmd = spawn('docker', ['network', 'create', networkName], { stdio: 'pipe' });
          createCmd.on('close', () => resolve());
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Obtener información del sistema Docker
   * @returns {Promise<Object>} - Información del sistema
   */
  static async getSystemInfo() {
    return new Promise((resolve, reject) => {
      exec('docker system df --format "table {{.Type}}\\t{{.Total}}\\t{{.Active}}\\t{{.Size}}"', (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          const lines = stdout.trim().split('\n');
          const data = {};
          
          if (lines.length > 1) {
            lines.slice(1).forEach(line => {
              const parts = line.split('\t');
              if (parts.length >= 4) {
                data[parts[0].toLowerCase()] = {
                  total: parts[1],
                  active: parts[2],
                  size: parts[3]
                };
              }
            });
          }
          
          resolve(data);
        }
      });
    });
  }

  /**
   * Limpiar sistema Docker (contenedores parados, imágenes no usadas, etc.)
   * @param {boolean} aggressive - Si true, limpia más agresivamente
   * @returns {Promise<string>} - Output del comando de limpieza
   */
  static async cleanupSystem(aggressive = false) {
    return new Promise((resolve, reject) => {
      const command = aggressive ? 'docker system prune -af' : 'docker system prune -f';
      
      exec(command, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  /**
   * Verificar conectividad de red desde un contenedor
   * @param {string} containerId - ID del contenedor
   * @param {string} host - Host a verificar (por defecto google.com)
   * @returns {Promise<boolean>} - true si hay conectividad
   */
  static async checkNetworkConnectivity(containerId, host = 'google.com') {
    try {
      await this.execInContainer(containerId, `ping -c 1 ${host}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Obtener IP del contenedor
   * @param {string} containerId - ID del contenedor
   * @returns {Promise<string>} - IP del contenedor
   */
  static async getContainerIP(containerId) {
    return new Promise((resolve, reject) => {
      exec(`docker inspect ${containerId} --format "{{.NetworkSettings.IPAddress}}"`, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  /**
   * Verificar salud de Docker
   * @returns {Promise<Object>} - Estado de salud de Docker
   */
  static async checkDockerHealth() {
    const health = {
      running: false,
      version: null,
      containers: 0,
      images: 0,
      volumes: 0,
      networks: 0,
      diskUsage: null
    };

    try {
      // Verificar si Docker está corriendo
      health.running = await this.checkDockerAvailable();

      if (health.running) {
        // Obtener versión
        const info = await this.getDockerInfo();
        health.version = info.version;

        // Contar recursos
        const counts = await Promise.all([
          this.countContainers(),
          this.countImages(),
          this.countVolumes(),
          this.countNetworks()
        ]);

        health.containers = counts[0];
        health.images = counts[1];
        health.volumes = counts[2];
        health.networks = counts[3];

        // Obtener uso de disco
        try {
          health.diskUsage = await this.getSystemInfo();
        } catch (error) {
          // Ignorar errores de disk usage
        }
      }
    } catch (error) {
      // Mantener valores por defecto en caso de error
    }

    return health;
  }

  /**
   * Contar contenedores
   * @returns {Promise<number>} - Número de contenedores
   */
  static async countContainers() {
    return new Promise((resolve) => {
      exec('docker ps -aq | wc -l', (error, stdout) => {
        resolve(error ? 0 : parseInt(stdout.trim()) || 0);
      });
    });
  }

  /**
   * Contar imágenes
   * @returns {Promise<number>} - Número de imágenes
   */
  static async countImages() {
    return new Promise((resolve) => {
      exec('docker images -q | wc -l', (error, stdout) => {
        resolve(error ? 0 : parseInt(stdout.trim()) || 0);
      });
    });
  }

  /**
   * Contar volúmenes
   * @returns {Promise<number>} - Número de volúmenes
   */
  static async countVolumes() {
    return new Promise((resolve) => {
      exec('docker volume ls -q | wc -l', (error, stdout) => {
        resolve(error ? 0 : parseInt(stdout.trim()) || 0);
      });
    });
  }

  /**
   * Contar redes
   * @returns {Promise<number>} - Número de redes
   */
  static async countNetworks() {
    return new Promise((resolve) => {
      exec('docker network ls -q | wc -l', (error, stdout) => {
        resolve(error ? 0 : parseInt(stdout.trim()) || 0);
      });
    });
  }
}

module.exports = DockerHelper;