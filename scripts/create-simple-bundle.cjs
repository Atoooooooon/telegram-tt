const fs = require('fs');
const path = require('path');

const BUNDLE_DIR = './dist-simple-bundle';
const DIST_DIR = './dist';

console.log('📦 创建简化独立应用包...');

// 清理并创建bundle目录
if (fs.existsSync(BUNDLE_DIR)) {
  fs.rmSync(BUNDLE_DIR, { recursive: true });
}
fs.mkdirSync(BUNDLE_DIR, { recursive: true });

// 复制dist文件夹
console.log('📁 复制web文件...');
if (fs.existsSync(DIST_DIR)) {
  fs.cpSync(DIST_DIR, path.join(BUNDLE_DIR, 'dist'), { recursive: true });
}

// 复制服务器文件
fs.copyFileSync('./standalone-server.js', path.join(BUNDLE_DIR, 'standalone-server.js'));

// 创建Windows批处理文件
const winBatContent = `@echo off
title Telegram Web Client
echo 🚀 启动 Telegram Web 客户端...
echo 请确保已安装 Node.js...
echo.

REM 检查Node.js是否安装
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Node.js！
    echo 请先安装 Node.js: https://nodejs.org
    pause
    exit /b 1
)

echo ✅ Node.js 已安装
node standalone-server.js
pause`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'start.bat'), winBatContent);

// 创建Linux/Mac启动脚本
const unixShContent = `#!/bin/bash
echo "🚀 启动 Telegram Web 客户端..."
echo "请确保已安装 Node.js..."
echo

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js！"
    echo "请先安装 Node.js: https://nodejs.org"
    exit 1
fi

echo "✅ Node.js 已安装"
node standalone-server.js`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'start.sh'), unixShContent);
fs.chmodSync(path.join(BUNDLE_DIR, 'start.sh'), '755');

// 创建README文件
const readmeContent = `# Telegram Web 客户端 - 简化独立版本

## ⚠️ 系统要求

**必须已安装 Node.js**
- 下载地址: https://nodejs.org
- 推荐版本: Node.js 18+ 

## 快速开始

### Windows用户
双击 \`start.bat\` 文件

### Mac/Linux用户  
双击 \`start.sh\` 文件或在终端中运行：
\`\`\`bash
./start.sh
\`\`\`

## 使用说明

1. 启动后会自动在浏览器中打开 http://localhost:3000
2. 如果浏览器没有自动打开，请手动访问 http://localhost:3000
3. 按 Ctrl+C 或关闭终端窗口来停止服务

## 文件说明

- \`start.bat\` - Windows启动脚本
- \`start.sh\` - Mac/Linux启动脚本
- \`standalone-server.js\` - 服务器文件
- \`dist/\` - 网页应用文件

## 优点

- 🌟 **体积小**: 不包含Node.js运行时，文件更小
- ⚡ **启动快**: 直接使用系统Node.js，启动速度更快
- 🔄 **易更新**: 可以直接替换文件进行更新

## 缺点

- ⚠️ **需要Node.js**: 用户系统必须已安装Node.js
- 📱 **技术门槛**: 对普通用户来说安装Node.js有一定门槛

---
客户端版本: ${require('../package.json').version}
构建时间: ${new Date().toLocaleString()}

## 完整版本

如果你希望获得无需安装Node.js的完整版本，请联系开发者获取包含可执行文件的版本。`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'README.md'), readmeContent);

// 创建package.json (可选，用于npm start)
const packageJsonContent = {
  "name": "telegram-web-standalone",
  "version": "1.0.0",
  "description": "Telegram Web Client Standalone",
  "main": "standalone-server.js",
  "scripts": {
    "start": "node standalone-server.js"
  }
};

fs.writeFileSync(path.join(BUNDLE_DIR, 'package.json'), JSON.stringify(packageJsonContent, null, 2));

console.log('✅ 简化独立应用包创建完成！');
console.log(`📁 输出目录: ${BUNDLE_DIR}`);
console.log('📋 包含文件:');
fs.readdirSync(BUNDLE_DIR).forEach(file => {
  const stats = fs.statSync(path.join(BUNDLE_DIR, file));
  const size = stats.isDirectory() ? '(文件夹)' : `(${(stats.size / 1024).toFixed(1)}KB)`;
  console.log(`   - ${file} ${size}`);
});

console.log('\n💡 提示:');
console.log('- 这个版本需要用户系统已安装 Node.js');
console.log('- 如需完全独立版本，请使用: npm run standalone:package');