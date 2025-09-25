#!/usr/bin/env node

// Auto-corrección de terminaciones de línea para compatibilidad cross-platform
const fs = require('fs');

if (process.platform !== 'win32') {
  try {
    const content = fs.readFileSync(__filename, 'utf8');
    if (content.includes('\r')) {
      const fixed = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      fs.writeFileSync(__filename, fixed);
      fs.chmodSync(__filename, 0o755);
      
      // Re-ejecutar el comando con los argumentos originales
      const { spawn } = require('child_process');
      spawn(process.execPath, [__filename, ...process.argv.slice(2)], {
        stdio: 'inherit'
      });
      process.exit(0);
    }
  } catch (error) {
    // Continuar si no se puede corregir
  }
}

const { program } = require('commander');
const chalk = require('chalk');

// Importar comandos
const devCommand = require('../src/commands/dev');
const initCommand = require('../src/commands/init');
const doctorCommand = require('../src/commands/doctor');

// Banner
console.log(chalk.blue('╔══════════════════════════════════════════════╗'));
console.log(chalk.blue('║              WPSite CLI v1.3.0               ║'));
console.log(chalk.blue('║         WordPress Development Tool           ║'));
console.log(chalk.blue('╚══════════════════════════════════════════════╝'));

program
  .name('wpsite')
  .description('WordPress development CLI tool powered by Docker')
  .version('1.3.0');

// Comando dev con opciones mejoradas
program
  .command('dev')
  .description('Start local WordPress development server')
  .option('-p, --port <number>', 'Port number', '8080')
  .option('-t, --tunel', 'Start ngrok tunnel for public access')
  .option('--tunnel', 'Start ngrok tunnel for public access (alias)')
  .action((options) => {
    // Normalizar opciones de túnel
    if (options.tunnel) {
      options.tunel = true;
    }
    
    devCommand(options);
  });

// Comando init
program
  .command('init')
  .description('Initialize wpsite configuration')
  .action(() => {
    initCommand();
  });

// Comando doctor
program
  .command('doctor')
  .description('Check system requirements')
  .action(() => {
    doctorCommand();
  });

// Comando de ayuda personalizado
program
  .addHelpText('after', `

Examples:
  $ wpsite init                    Initialize new project
  $ wpsite dev                     Start development server
  $ wpsite dev --port 3000         Use custom port
  $ wpsite dev --tunel             Start with public tunnel
  $ wpsite doctor                  Check system requirements

Notes:
  • wpsite requires Docker to be installed and running
  • Your wp-content should be cloned from Git repository
  • Database connection is configured in wpsite.config.js
  • Tunnels require ngrok to be installed and configured

For more information, visit: https://github.com/jesusuzcategui/wpsite-cli
`);

// Manejo de comandos inexistentes
program.on('command:*', function (operands) {
  console.error(chalk.red(`❌ Comando desconocido: ${operands[0]}`));
  console.log(chalk.yellow('\nComandos disponibles:'));
  console.log(chalk.blue('  wpsite dev      - Iniciar servidor de desarrollo'));
  console.log(chalk.blue('  wpsite init     - Inicializar configuración'));
  console.log(chalk.blue('  wpsite doctor   - Verificar requisitos'));
  console.log(chalk.yellow('\nUsa "wpsite --help" para más información'));
  process.exit(1);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Error no capturado:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('❌ Promesa rechazada:'), reason);
  process.exit(1);
});

program.parse();