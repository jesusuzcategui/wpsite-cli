const fs = require('fs');
const chalk = require('chalk');

module.exports = () => {
  console.log(chalk.blue('🔧 Inicializando configuración de wpsite...\n'));

  // Verificar si ya existe configuración
  if (fs.existsSync('./wpsite.config.js')) {
    console.log(chalk.yellow('⚠️  wpsite.config.js ya existe'));
    console.log(chalk.blue('   Para reconfigurar, elimina el archivo existente y ejecuta init nuevamente'));
    return;
  }

  // Verificar que existe wp-content
  if (!fs.existsSync('./wp-content')) {
    console.log(chalk.red('❌ No se encontró la carpeta wp-content/'));
    console.log(chalk.yellow('   Asegúrate de estar en el directorio raíz de tu proyecto WordPress'));
    console.log(chalk.blue('   Ejemplo:'));
    console.log(chalk.blue('     git clone tu-repo-wp.git mi-proyecto'));
    console.log(chalk.blue('     cd mi-proyecto'));
    console.log(chalk.blue('     wpsite init'));
    return;
  }

  // Crear archivo de configuración
  const configTemplate = `module.exports = {
  // Nombre del proyecto
  name: "mi-sitio-wordpress",
  
  // === CONFIGURACIÓN DE BASE DE DATOS REMOTA ===
  database: {
    host: "tu-servidor-remoto.com",     // Cambia por tu servidor MySQL
    name: "nombre_de_tu_bd",            // Cambia por el nombre de tu base de datos
    user: "usuario_bd",                 // Cambia por tu usuario de MySQL
    password: "tu_password_aqui",       // Cambia por tu contraseña
    tablePrefix: "wp_"                  // Prefijo de tablas (normalmente wp_)
  },
  
  // === CONFIGURACIÓN DEL SERVIDOR LOCAL ===
  server: {
    port: 8080                          // Puerto por defecto (puedes cambiarlo)
  },
  
  // === CONFIGURACIÓN OPCIONAL ===
  // Proxy para archivos remotos (opcional)
  proxy: {
    uploads: "https://tu-sitio-remoto.com/wp-content/uploads"
  }
};
`;

  try {
    fs.writeFileSync('./wpsite.config.js', configTemplate);
    
    console.log(chalk.green('✅ wpsite.config.js creado exitosamente'));
    console.log(chalk.yellow('\n📝 Pasos siguientes:'));
    console.log(chalk.blue('   1. Edita wpsite.config.js con los datos de tu base de datos'));
    console.log(chalk.blue('   2. Ejecuta: wpsite dev'));
    console.log(chalk.yellow('\n💡 Ejemplo de configuración:'));
    console.log(chalk.gray('   database: {'));
    console.log(chalk.gray('     host: "mysql.miservidor.com",'));
    console.log(chalk.gray('     name: "wordpress_db",'));
    console.log(chalk.gray('     user: "wp_user",'));
    console.log(chalk.gray('     password: "mi_password_seguro"'));
    console.log(chalk.gray('   }'));
    console.log(chalk.yellow('\n🔒 Nota: wpsite.config.js contiene credenciales sensibles.'));
    console.log(chalk.yellow('    Asegúrate de que esté en tu .gitignore'));
    
  } catch (error) {
    console.error(chalk.red('❌ Error creando wpsite.config.js:'), error.message);
    process.exit(1);
  }
};