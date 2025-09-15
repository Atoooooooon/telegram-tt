const fs = require('fs');
const path = require('path');

const BUNDLE_DIR = './dist-standalone-bundle';
const DIST_DIR = './dist';
const EXE_DIR = './dist-standalone';

console.log('📦 创建独立应用包...');

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

// 复制可执行文件
console.log('🔧 复制可执行文件...');
const exeFiles = fs.readdirSync(EXE_DIR).filter(file => 
  file.includes('standalone-server') && !file.endsWith('.js')
);

exeFiles.forEach(file => {
  const srcPath = path.join(EXE_DIR, file);
  const destPath = path.join(BUNDLE_DIR, file);
  fs.copyFileSync(srcPath, destPath);
  
  // 在Unix系统上设置执行权限
  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, '755');
  }
});

// 创建Windows批处理文件
const winBatContent = `@echo off
title Telegram Web Client
echo 🚀 启动 Telegram Web 客户端...
echo.
standalone-server-win.exe
pause`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'start.bat'), winBatContent);

// 创建Linux/Mac启动脚本
const unixShContent = `#!/bin/bash
echo "🚀 启动 Telegram Web 客户端..."
echo
if [[ "$OSTYPE" == "darwin"* ]]; then
    ./standalone-server-macos
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    ./standalone-server-linux
else
    echo "❌ 不支持的操作系统: $OSTYPE"
    exit 1
fi`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'start.sh'), unixShContent);
fs.chmodSync(path.join(BUNDLE_DIR, 'start.sh'), '755');

// 创建README文件
const readmeContent = `# Telegram Web 客户端 - 独立版本

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
- \`standalone-server-*\` - 各平台的可执行文件
- \`dist/\` - 网页应用文件

## 系统要求

- Windows 7+ / macOS 10.12+ / Linux
- 现代浏览器 (Chrome, Firefox, Safari, Edge)

---
客户端版本: ${require('../package.json').version}
构建时间: ${new Date().toLocaleString()}`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'README.md'), readmeContent);

console.log('✅ 独立应用包创建完成！');
console.log(`📁 输出目录: ${BUNDLE_DIR}`);
console.log('📋 包含文件:');
fs.readdirSync(BUNDLE_DIR).forEach(file => {
  console.log(`   - ${file}`);
});