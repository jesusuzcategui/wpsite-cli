const { exec } = require('child_process');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const os = require('os');

module.exports = async () => {
  console.log(chalk.blue('🔍 Verificando requisitos del sistema...\n'));

  const checks = [
    { name: 'Node.js', check: checkNode, required: true },
    { name: 'Docker', check: checkDocker, required: true },
    { name: 'Git', check: checkGit, required: false },
    { name: 'Curl', check: checkCurl, required: false },
    { name: 'Sistema Operativo', check: checkOS, required: false }
  ];

  let allPassed = true;

  for (const { name, check, required } of checks) {
    const spinner = ora(`Verificando ${name}...`).start();
    const result = await check();
    
    if (result.success) {
      spinner.succeed(`${name}: ${chalk.green(result.message)}`);
    } else {
      if (required) {
        spinner.fail(`${name}: ${chalk.red(result.message)}`);
        allPassed = false;
      } else {
        spinner.warn(`${name}: ${chalk.yellow(result.message)}`);
      }
      
      if (result.suggestion) {
        console.log(chalk.blue(`   💡 ${result.suggestion}`));
      }
    }
  }

  console.log();

  if (allPassed) {
    console.log(chalk.green('✅ Todos los requisitos obligatorios están cumplidos'));
    console.log(chalk.blue('🚀 wpsite está listo para usar!'));
    console.log(chalk.yellow('\n📋 Comandos disponibles:'));
    console.log(chalk.blue('   wpsite init    - Inicializar proyecto'));
    console.log(chalk.blue('   wpsite dev     - Iniciar servidor de desarrollo'));
    console.log(chalk.blue('   wpsite doctor  - Verificar requisitos (este comando)'));
  } else {
    console.log(chalk.red('❌ Algunos requisitos obligatorios no están cumplidos'));
    console.log(chalk.yellow('   Instala las dependencias faltantes y ejecuta wpsite doctor nuevamente'));
  }

  // Información adicional del sistema
  console.log(chalk.gray('\n' + '='.repeat(50)));
  console.log(chalk.gray('ℹ️  Información del sistema:'));
  console.log(chalk.gray(`   SO: ${os.type()} ${os.release()}`));
  console.log(chalk.gray(`   Arquitectura: ${os.arch()}`));
  console.log(chalk.gray(`   Memoria total: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`));
  console.log(chalk.gray(`   CPUs: ${os.cpus().length}`));
};

async function checkNode() {
  return new Promise((resolve) => {
    exec('node --version', (error, stdout) => {
      if (error) {
        resolve({ 
          success: false, 
          message: 'No instalado',
          suggestion: 'Instala Node.js desde https://nodejs.org/'
        });
      } else {
        const version = stdout.trim();
        const majorVersion = parseInt(version.replace('v', '').split('.')[0]);
        
        if (majorVersion < 14) {
          resolve({
            success: false,
            message: `${version} (requiere v14+)`,
            suggestion: 'Actualiza Node.js a la versión 14 o superior'
          });
        } else {
          resolve({ success: true, message: version });
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
          suggestion: 'Instala Docker Desktop desde https://docs.docker.com/get-docker/'
        });
      } else {
        // Verificar que Docker esté corriendo
        exec('docker info', (infoError) => {
          if (infoError) {
            resolve({
              success: false,
              message: 'Instalado pero no está corriendo',
              suggestion: 'Inicia Docker Desktop'
            });
          } else {
            const version = stdout.trim().replace('Docker version ', '');
            resolve({ success: true, message: version });
          }
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
          suggestion: 'Instala Git desde https://git-scm.com/'
        });
      } else {
        resolve({ success: true, message: stdout.trim() });
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

async function checkOS() {
  return new Promise((resolve) => {
    const platform = os.platform();
    const platformNames = {
      'win32': 'Windows',
      'darwin': 'macOS',
      'linux': 'Linux'
    };
    
    const platformName = platformNames[platform] || platform;
    resolve({ 
      success: true, 
      message: `${platformName} ${os.release()}`
    });
  });
}