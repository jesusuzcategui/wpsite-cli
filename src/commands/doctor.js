const { exec } = require('child_process');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async () => {
  console.log(chalk.blue('🔍 Verificando requisitos del sistema...\n'));

  const checks = [
    { name: 'Node.js', check: checkNode, required: true },
    { name: 'Docker', check: checkDocker, required: true },
    { name: 'Docker Image', check: checkDockerImage, required: false },
    { name: 'Git', check: checkGit, required: false },
    { name: 'Ngrok', check: checkNgrok, required: false },
    { name: 'Curl', check: checkCurl, required: false },
    { name: 'Permisos de Archivos', check: checkFilePermissions, required: false },
    { name: 'Sistema Operativo', check: checkOS, required: false }
  ];

  let allPassed = true;
  let criticalPassed = true;

  for (const { name, check, required } of checks) {
    const spinner = ora(`Verificando ${name}...`).start();
    const result = await check();
    
    if (result.success) {
      spinner.succeed(`${name}: ${chalk.green(result.message)}`);
    } else {
      if (required) {
        spinner.fail(`${name}: ${chalk.red(result.message)}`);
        criticalPassed = false;
        allPassed = false;
      } else {
        spinner.warn(`${name}: ${chalk.yellow(result.message)}`);
        allPassed = false;
      }
      
      if (result.suggestion) {
        console.log(chalk.blue(`   💡 ${result.suggestion}`));
      }
      
      if (result.fix) {
        console.log(chalk.gray(`   🔧 ${result.fix}`));
      }
    }
  }

  console.log();

  // Mostrar resumen
  if (criticalPassed) {
    console.log(chalk.green('✅ Todos los requisitos obligatorios están cumplidos'));
    
    if (allPassed) {
      console.log(chalk.green('🎉 Sistema completamente listo para desarrollo!'));
    } else {
      console.log(chalk.yellow('⚠️ Algunos componentes opcionales necesitan atención'));
    }
    
    console.log(chalk.blue('🚀 wpsite está listo para usar!'));
    showUsageInstructions();
  } else {
    console.log(chalk.red('❌ Algunos requisitos obligatorios no están cumplidos'));
    console.log(chalk.yellow('   Instala las dependencias faltantes y ejecuta wpsite doctor nuevamente'));
  }

  // Información adicional del sistema
  showSystemInfo();
};

async function checkNode() {
  return new Promise((resolve) => {
    exec('node --version', (error, stdout) => {
      if (error) {
        resolve({ 
          success: false, 
          message: 'No instalado',
          suggestion: 'Instala Node.js desde https://nodejs.org/',
          fix: 'Descarga la versión LTS recomendada'
        });
      } else {
        const version = stdout.trim();
        const majorVersion = parseInt(version.replace('v', '').split('.')[0]);
        
        if (majorVersion < 14) {
          resolve({
            success: false,
            message: `${version} (requiere v14+)`,
            suggestion: 'Actualiza Node.js a la versión 14 o superior',
            fix: 'Descarga la última versión desde nodejs.org'
          });
        } else {
          resolve({ 
            success: true, 
            message: `${version} (Compatible)` 
          });
        }
      }
    });
  });
}

async function checkDocker() {
  return new Promise((resolve) => {
    exec('docker --version', (error, stdout) => {
      if (error) {
        resolve({ 
          success: false, 
          message: 'No instalado',
          suggestion: 'Instala Docker Desktop desde https://docs.docker.com/get-docker/',
          fix: 'Docker es obligatorio para wpsite'
        });
      } else {
        // Verificar que Docker esté corriendo
        exec('docker info', (infoError) => {
          if (infoError) {
            resolve({
              success: false,
              message: 'Instalado pero no está corriendo',
              suggestion: 'Inicia Docker Desktop',
              fix: 'Abre Docker Desktop y espera a que inicie completamente'
            });
          } else {
            const version = stdout.trim().replace('Docker version ', '');
            
            // Verificar espacio disponible
            exec('docker system df', (dfError, dfStdout) => {
              let spaceInfo = '';
              if (!dfError && dfStdout) {
                const lines = dfStdout.split('\n');
                if (lines.length > 1) {
                  spaceInfo = ' - Espacio OK';
                }
              }
              
              resolve({ 
                success: true, 
                message: `${version}${spaceInfo}` 
              });
            });
          }
        });
      }
    });
  });
}

async function checkDockerImage() {
  return new Promise((resolve) => {
    exec('docker images -q wpsite-wordpress:latest', (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve({
          success: false,
          message: 'Imagen personalizada no encontrada',
          suggestion: 'Se creará automáticamente en el primer uso',
          fix: 'Ejecuta "wpsite dev" para construir la imagen'
        });
      } else {
        // Obtener información de la imagen
        exec('docker images wpsite-wordpress:latest --format "table {{.Size}}"', (sizeError, sizeStdout) => {
          const lines = sizeStdout.split('\n');
          const size = lines.length > 1 ? lines[1] : 'Desconocido';
          resolve({
            success: true,
            message: `Disponible (${size})`
          });
        });
      }
    });
  });
}

async function checkGit() {
  return new Promise((resolve) => {
    exec('git --version', (error, stdout) => {
      if (error) {
        resolve({ 
          success: false, 
          message: 'No instalado',
          suggestion: 'Instala Git desde https://git-scm.com/',
          fix: 'Git es útil para versionar tu wp-content'
        });
      } else {
        // Verificar configuración de Git
        exec('git config --global user.name && git config --global user.email', (configError) => {
          const version = stdout.trim();
          if (configError) {
            resolve({
              success: true,
              message: `${version} (sin configurar)`,
              suggestion: 'Configura Git: git config --global user.name "Tu Nombre"',
              fix: 'git config --global user.email "tu@email.com"'
            });
          } else {
            resolve({ 
              success: true, 
              message: `${version} (configurado)` 
            });
          }
        });
      }
    });
  });
}

async function checkNgrok() {
  return new Promise((resolve) => {
    exec('ngrok version', (error, stdout) => {
      if (error) {
        resolve({ 
          success: false, 
          message: 'No instalado',
          suggestion: 'Instala ngrok para túneles públicos',
          fix: 'Descarga desde https://ngrok.com/download'
        });
      } else {
        // Verificar si está autenticado
        exec('ngrok config check', (authError) => {
          const version = stdout.trim().split('\n')[0];
          if (authError) {
            resolve({
              success: true,
              message: `${version} (sin token)`,
              suggestion: 'Configura tu token: ngrok config add-authtoken TU_TOKEN',
              fix: 'Obtén tu token gratis en ngrok.com'
            });
          } else {
            resolve({ 
              success: true, 
              message: `${version} (autenticado)` 
            });
          }
        });
      }
    });
  });
}

async function checkCurl() {
  return new Promise((resolve) => {
    exec('curl --version', (error, stdout) => {
      if (error) {
        resolve({ 
          success: false, 
          message: 'No instalado',
          suggestion: 'Curl es útil para testing pero no es obligatorio'
        });
      } else {
        const version = stdout.split('\n')[0];
        resolve({ success: true, message: version });
      }
    });
  });
}

async function checkFilePermissions() {
  return new Promise((resolve) => {
    const testDir = path.join(os.tmpdir(), 'wpsite-test');
    
    try {
      // Intentar crear directorio temporal
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir);
      }
      
      // Intentar crear archivo de prueba
      const testFile = path.join(testDir, 'test.txt');
      fs.writeFileSync(testFile, 'test');
      
      // Limpiar
      fs.unlinkSync(testFile);
      fs.rmdirSync(testDir);
      
      resolve({
        success: true,
        message: 'Lectura y escritura OK'
      });
    } catch (error) {
      resolve({
        success: false,
        message: 'Problemas de permisos detectados',
        suggestion: 'Verifica permisos de escritura en el directorio actual',
        fix: 'En macOS/Linux: sudo chown -R $USER:$USER .'
      });
    }
  });
}

async function checkOS() {
  return new Promise((resolve) => {
    const platform = os.platform();
    const platformNames = {
      'win32': 'Windows',
      'darwin': 'macOS',
      'linux': 'Linux'
    };
    
    const platformName = platformNames[platform] || platform;
    const arch = os.arch();
    const release = os.release();
    
    // Verificar arquitectura compatible
    const supportedArchs = ['x64', 'arm64'];
    const isArchSupported = supportedArchs.includes(arch);
    
    if (!isArchSupported) {
      resolve({
        success: false,
        message: `${platformName} ${arch} (no soportado)`,
        suggestion: 'wpsite requiere arquitectura x64 o arm64',
        fix: 'Considera usar una máquina con arquitectura compatible'
      });
    } else {
      resolve({ 
        success: true, 
        message: `${platformName} ${release} (${arch})` 
      });
    }
  });
}

function showUsageInstructions() {
  console.log(chalk.yellow('\n📋 Comandos disponibles:'));
  console.log(chalk.blue('   wpsite init    - Inicializar proyecto'));
  console.log(chalk.blue('   wpsite dev     - Iniciar servidor de desarrollo'));
  console.log(chalk.blue('   wpsite dev -t  - Iniciar con túnel público'));
  console.log(chalk.blue('   wpsite doctor  - Verificar requisitos (este comando)'));
  
  console.log(chalk.yellow('\n🚀 Inicio rápido:'));
  console.log(chalk.gray('   1. cd tu-proyecto-wordpress/'));
  console.log(chalk.gray('   2. wpsite init'));
  console.log(chalk.gray('   3. Editar wpsite.config.js'));
  console.log(chalk.gray('   4. wpsite dev'));
}

function showSystemInfo() {
  console.log(chalk.gray('\n' + '='.repeat(50)));
  console.log(chalk.gray('ℹ️  Información detallada del sistema:'));
  console.log(chalk.gray(`   SO: ${os.type()} ${os.release()}`));
  console.log(chalk.gray(`   Arquitectura: ${os.arch()}`));
  console.log(chalk.gray(`   Memoria total: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`));
  console.log(chalk.gray(`   CPUs: ${os.cpus().length} cores`));
  console.log(chalk.gray(`   Node.js: ${process.version}`));
  console.log(chalk.gray(`   Directorio actual: ${process.cwd()}`));
  console.log(chalk.gray(`   Usuario: ${os.userInfo().username}`));
}