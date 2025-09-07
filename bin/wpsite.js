#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');

// Importar comandos
const devCommand = require('../src/commands/dev');
const initCommand = require('../src/commands/init');
const doctorCommand = require('../src/commands/doctor');

// Banner
console.log(chalk.blue('╔══════════════════════════════════════════════╗'));
console.log(chalk.blue('║              WPSite CLI v1.0.0               ║'));
console.log(chalk.blue('║         WordPress Development Tool           ║'));
console.log(chalk.blue('╚══════════════════════════════════════════════╝'));

program
  .name('wpsite')
  .description('WordPress development CLI tool powered by Docker')
  .version('1.0.0');

// Comando dev
program
  .command('dev')
  .description('Start local WordPress development server')
  .option('-p, --port <number>', 'Port number', '8080')
  .option('-t, --tunel', 'Start ngrok tunnel for public access')
  .action((options) => {
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

// Manejo de comandos inexistentes
program.on('command:*', function (operands) {
  console.error(chalk.red(`❌ Comando desconocido: ${operands[0]}`));
  console.log(chalk.yellow('Comandos disponibles:'));
  console.log(chalk.blue('  wpsite dev      - Iniciar servidor de desarrollo'));
  console.log(chalk.blue('  wpsite init     - Inicializar configuración'));
  console.log(chalk.blue('  wpsite doctor   - Verificar requisitos'));
  process.exit(1);
});

program.parse();