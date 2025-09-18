const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { exec } = require('child_process');

module.exports = () => {
  console.log(chalk.blue('🔧 Inicializando configuración de wpsite...\n'));

  // Verificar si ya existe configuración
  if (fs.existsSync('./wpsite.config.js')) {
    console.log(chalk.yellow('⚠️  wpsite.config.js ya existe'));
    console.log(chalk.blue('   Para reconfigurar, elimina el archivo existente y ejecuta init nuevamente'));
    console.log(chalk.gray('   rm wpsite.config.js && wpsite init'));
    return;
  }

  // Verificar que existe wp-content
  if (!fs.existsSync('./wp-content')) {
    console.log(chalk.red('❌ No se encontró la carpeta wp-content/'));
    console.log(chalk.yellow('   Asegúrate de estar en el directorio raíz de tu proyecto WordPress'));
    console.log(chalk.blue('\n📋 Estructura esperada:'));
    console.log(chalk.gray('   mi-proyecto/'));
    console.log(chalk.gray('   ├── wp-content/'));
    console.log(chalk.gray('   │   ├── themes/'));
    console.log(chalk.gray('   │   └── plugins/'));
    console.log(chalk.gray('   └── wpsite.config.js (se creará)'));
    console.log(chalk.blue('\n🚀 Ejemplo de setup:'));
    console.log(chalk.gray('     git clone tu-repo-wp.git mi-proyecto'));
    console.log(chalk.gray('     cd mi-proyecto'));
    console.log(chalk.gray('     wpsite init'));
    return;
  }

  // Detectar información del proyecto automáticamente
  const projectInfo = detectProjectInfo();

  // Crear archivo de configuración
  const configTemplate = generateConfigTemplate(projectInfo);

  try {
    fs.writeFileSync('./wpsite.config.js', configTemplate);
    
    console.log(chalk.green('✅ wpsite.config.js creado exitosamente'));
    
    // Mostrar información del proyecto detectado
    if (projectInfo.name) {
      console.log(chalk.blue(`📁 Proyecto detectado: ${projectInfo.name}`));
    }
    if (projectInfo.themes.length > 0) {
      console.log(chalk.blue(`🎨 Temas encontrados: ${projectInfo.themes.join(', ')}`));
    }
    if (projectInfo.plugins.length > 0) {
      console.log(chalk.blue(`🔌 Plugins encontrados: ${projectInfo.plugins.length} plugins`));
    }

    console.log(chalk.yellow('\n📝 Pasos siguientes:'));
    console.log(chalk.blue('   1. Edita wpsite.config.js con los datos de tu base de datos'));
    console.log(chalk.blue('   2. Ejecuta: wpsite dev'));
    console.log(chalk.blue('   3. Opcional: wpsite dev --tunel (para acceso público)'));
    
    console.log(chalk.yellow('\n💡 Ejemplo de configuración de BD:'));
    console.log(chalk.gray('   database: {'));
    console.log(chalk.gray('     host: "mysql.miservidor.com",'));
    console.log(chalk.gray('     name: "wordpress_db",'));
    console.log(chalk.gray('     user: "wp_user",'));
    console.log(chalk.gray('     password: "mi_password_seguro"'));
    console.log(chalk.gray('   }'));
    
    console.log(chalk.yellow('\n🔒 Nota de seguridad:'));
    console.log(chalk.yellow('    wpsite.config.js contiene credenciales sensibles.'));
    console.log(chalk.yellow('    Asegúrate de que esté en tu .gitignore'));
    
    // Verificar si existe .gitignore y sugerir agregarlo
    checkGitIgnore();
    
  } catch (error) {
    console.error(chalk.red('❌ Error creando wpsite.config.js:'), error.message);
    process.exit(1);
  }
};

// Detectar información del proyecto automáticamente
function detectProjectInfo() {
  const info = {
    name: '',
    themes: [],
    plugins: [],
    hasGit: false,
    gitRemote: ''
  };

  // Detectar nombre del proyecto desde package.json o directorio
  try {
    if (fs.existsSync('./package.json')) {
      const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
      info.name = packageJson.name || path.basename(process.cwd());
    } else {
      info.name = path.basename(process.cwd());
    }
  } catch (error) {
    info.name = path.basename(process.cwd());
  }

  // Detectar temas
  try {
    const themesDir = './wp-content/themes';
    if (fs.existsSync(themesDir)) {
      const themes = fs.readdirSync(themesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .filter(name => !name.startsWith('.') && !name.startsWith('twenty')); // Excluir temas por defecto
      info.themes = themes;
    }
  } catch (error) {
    // Ignorar errores
  }

  // Detectar plugins
  try {
    const pluginsDir = './wp-content/plugins';
    if (fs.existsSync(pluginsDir)) {
      const plugins = fs.readdirSync(pluginsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .filter(name => !name.startsWith('.') && name !== 'akismet' && name !== 'hello.php');
      info.plugins = plugins;
    }
  } catch (error) {
    // Ignorar errores
  }

  // Detectar información de Git
  try {
    if (fs.existsSync('./.git')) {
      info.hasGit = true;
      // Intentar obtener remote origin
      exec('git remote get-url origin', (error, stdout) => {
        if (!error) {
          info.gitRemote = stdout.trim();
        }
      });
    }
  } catch (error) {
    // Ignorar errores
  }

  return info;
}

// Generar template de configuración personalizado
function generateConfigTemplate(projectInfo) {
  const template = `module.exports = {
  // === INFORMACIÓN DEL PROYECTO ===
  name: "${projectInfo.name}",
  
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
  },
  
  // === INFORMACIÓN DETECTADA AUTOMÁTICAMENTE ===
  project: {
    themes: ${JSON.stringify(projectInfo.themes, null, 4)},
    plugins: ${JSON.stringify(projectInfo.plugins, null, 4)},
    hasGit: ${projectInfo.hasGit}${projectInfo.gitRemote ? `,
    gitRemote: "${projectInfo.gitRemote}"` : ''}
  }
};

/*
 * INSTRUCCIONES:
 * 
 * 1. OBLIGATORIO - Configurar base de datos:
 *    Edita la sección 'database' con los datos de tu servidor MySQL remoto
 * 
 * 2. OPCIONAL - Cambiar puerto:
 *    Si el puerto 8080 está ocupado, cambia 'server.port'
 * 
 * 3. OPCIONAL - Proxy de uploads:
 *    Si tienes imágenes en tu sitio remoto, configura 'proxy.uploads'
 * 
 * 4. SEGURIDAD:
 *    Este archivo contiene credenciales sensibles.
 *    NO lo subas a Git. Debe estar en .gitignore
 * 
 * 5. TESTING:
 *    Después de configurar, ejecuta: wpsite dev
 */`;

  return template;
}

// Verificar y sugerir .gitignore
function checkGitIgnore() {
  const gitignorePath = './.gitignore';
  const configLine = 'wpsite.config.js';
  
  try {
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      
      if (!gitignoreContent.includes(configLine)) {
        console.log(chalk.yellow('\n⚠️  Recomendación de seguridad:'));
        console.log(chalk.blue('   Agrega wpsite.config.js a tu .gitignore'));
        console.log(chalk.gray(`   echo "${configLine}" >> .gitignore`));
      } else {
        console.log(chalk.green('\n✅ wpsite.config.js ya está en .gitignore'));
      }
    } else {
      console.log(chalk.yellow('\n💡 Considera crear un .gitignore:'));
      console.log(chalk.gray('   echo "wpsite.config.js" > .gitignore'));
      console.log(chalk.gray('   echo "wordpress/" >> .gitignore'));
      console.log(chalk.gray('   echo "node_modules/" >> .gitignore'));
    }
  } catch (error) {
    // Ignorar errores de .gitignore
  }
}