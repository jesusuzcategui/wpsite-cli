const { exec, spawn } = require('child_process');
const net = require('net');

class DockerHelper {
  
  /**
   * Verificar si un puerto está disponible
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
   */
  static async checkDockerAvailable() {
    return new Promise((resolve) => {
      exec('docker info', (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Obtener información de Docker
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
   */
  static async cleanupContainers() {
    return new Promise((resolve) => {
      exec('docker ps -aq --filter "name=wpsite-dev-*"', (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve();
          return;
        }

        const containerIds = stdout.trim().split('\n');
        
        // Detener y remover contenedores
        const cleanupCmd = spawn('docker', ['rm', '-f', ...containerIds], { stdio: 'pipe' });
        cleanupCmd.on('close', () => resolve());
      });
    });
  }

  /**
   * Verificar si una imagen Docker existe localmente
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
}

module.exports = DockerHelper;