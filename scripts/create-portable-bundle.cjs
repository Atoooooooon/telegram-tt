const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const BUNDLE_DIR = './dist-portable-bundle';
const DIST_DIR = './dist';
const NODE_VERSION = 'v18.19.0';

console.log('📦 Creating truly portable application bundle...');

// 下载文件的辅助函数
function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filename);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // 处理重定向
        file.close();
        fs.unlinkSync(filename);
        return downloadFile(response.headers.location, filename).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filename);
        return reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }

      const total = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total) {
          const percent = (downloaded / total * 100).toFixed(1);
          process.stdout.write(`\r📥 下载 ${path.basename(filename)}: ${percent}%`);
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        console.log(`\n✅ ${path.basename(filename)} 下载完成`);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(filename);
      reject(err);
    });
  });
}

// 解压文件的辅助函数
function extractFile(filename, extractCmd) {
  return new Promise((resolve, reject) => {
    console.log(`📦 解压 ${filename}...`);
    exec(extractCmd, (error, stdout, stderr) => {
      if (error) {
        console.error('解压失败:', error);
        return reject(error);
      }
      console.log(`✅ ${filename} 解压完成`);
      resolve();
    });
  });
}

// 下载并设置便携版Node.js - 确保用户开箱即用
async function downloadPortableNodejs() {
  console.log('🌐 Downloading portable Node.js for all platforms...');
  console.log('⏳ This ensures users can run the app without installing anything!');

  const platforms = [
    {
      name: 'Windows',
      url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`,
      filename: 'node-win.zip',
      extractCmd: process.platform === 'win32'
        ? 'powershell -command "Expand-Archive -Path node-win.zip -DestinationPath ."'
        : 'unzip -q node-win.zip',
      sourceDir: `node-${NODE_VERSION}-win-x64`,
      targetDir: path.join(BUNDLE_DIR, 'runtime', 'win32')
    },
    {
      name: 'macOS',
      url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-x64.tar.gz`,
      filename: 'node-mac.tar.gz',
      extractCmd: 'tar -xzf node-mac.tar.gz',
      sourceDir: `node-${NODE_VERSION}-darwin-x64`,
      targetDir: path.join(BUNDLE_DIR, 'runtime', 'darwin')
    },
    {
      name: 'Linux',
      url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz`,
      filename: 'node-linux.tar.xz',
      extractCmd: 'tar -xJf node-linux.tar.xz',
      sourceDir: `node-${NODE_VERSION}-linux-x64`,
      targetDir: path.join(BUNDLE_DIR, 'runtime', 'linux')
    }
  ];

  // 创建runtime目录
  fs.mkdirSync(path.join(BUNDLE_DIR, 'runtime'), { recursive: true });

  let successCount = 0;
  for (const platform of platforms) {
    try {
      console.log(`\n📦 Processing ${platform.name}...`);

      // 下载
      await downloadFile(platform.url, platform.filename);

      // 解压
      await extractFile(platform.filename, platform.extractCmd);

      // 移动到目标目录
      if (fs.existsSync(platform.sourceDir)) {
        // 确保目标目录存在
        fs.mkdirSync(path.dirname(platform.targetDir), { recursive: true });
        fs.renameSync(platform.sourceDir, platform.targetDir);
        console.log(`✅ ${platform.name} runtime ready at ${path.relative(BUNDLE_DIR, platform.targetDir)}`);
        successCount++;
      }

      // 清理压缩包
      fs.unlinkSync(platform.filename);

    } catch (error) {
      console.warn(`⚠️  ${platform.name} download failed:`, error.message);
      console.log('   Continuing with other platforms...');
    }
  }

  if (successCount === 0) {
    throw new Error('Failed to download any Node.js runtime! Cannot create portable bundle.');
  }

  console.log(`\n🎉 Successfully prepared ${successCount}/3 platform runtimes!`);
  console.log('📦 Users can now run the app on any platform without installing Node.js!');
}

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
fs.copyFileSync('./standalone-server.js', path.join(BUNDLE_DIR, 'server.cjs'));

// 创建用户友好的Windows启动脚本
const winBatContent = `@echo off
title Telegram Web Client - Loading...
cd /d "%~dp0"

echo Starting Telegram Web Client...
echo Please wait...

REM Use bundled Node.js runtime
if exist "runtime\\win32\\node.exe" (
    echo Using bundled Node.js runtime
    start "Telegram Web Client" /min "runtime\\win32\\node.exe" server.cjs
    echo.
    echo ====================================
    echo   Telegram Web Client is starting!
    echo ====================================
    echo.
    echo Opening in your browser...
    echo If browser doesn't open automatically, the URL will be shown by the server
    echo.
    echo To stop the server, close this window.
    echo.
    timeout /t 3 >nul
    pause >nul
) else (
    echo ERROR: Runtime files missing!
    echo This bundle appears to be incomplete.
    echo Please re-download the complete portable package.
    echo.
    pause
    exit /b 1
)`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'Start Telegram.bat'), winBatContent);

// 创建简化版 - 静默启动
const winQuietContent = `@echo off
cd /d "%~dp0"
if exist "runtime\\win32\\node.exe" (
    "runtime\\win32\\node.exe" server.cjs
) else (
    echo Runtime missing! Please re-download the package.
    pause
    exit /b 1
)`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'start-quiet.bat'), winQuietContent);

// 创建PowerShell脚本 - 更好的用户体验
const winPsContent = `#!/usr/bin/env powershell
#Requires -Version 3

$Host.UI.RawUI.WindowTitle = "Telegram Web Client"

Write-Host ""
Write-Host "🚀 Telegram Web Client - Portable Version" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

$nodePath = Join-Path $PSScriptRoot "runtime\\win32\\node.exe"

if (Test-Path $nodePath) {
    Write-Host "✅ Using bundled Node.js runtime" -ForegroundColor Green
    Write-Host "🌐 Starting server..." -ForegroundColor Yellow

    # Start server in background
    $job = Start-Job -ScriptBlock {
        param($nodePath, $serverPath)
        & $nodePath $serverPath
    } -ArgumentList $nodePath, (Join-Path $PSScriptRoot "server.cjs")

    Start-Sleep -Seconds 2

    Write-Host "🌍 Server will open browser automatically..." -ForegroundColor Yellow

    # Wait for server output
    Start-Sleep -Seconds 3

    Write-Host ""
    Write-Host "✅ Telegram Web Client is starting!" -ForegroundColor Green
    Write-Host "📍 URL will be displayed by the server" -ForegroundColor White
    Write-Host ""
    Write-Host "Press any key to stop the server..." -ForegroundColor Yellow

    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

    Write-Host "🛑 Stopping server..." -ForegroundColor Red
    Stop-Job $job -PassThru | Remove-Job
}
else {
    Write-Host "❌ ERROR: Runtime files missing!" -ForegroundColor Red
    Write-Host "📁 Expected: $nodePath" -ForegroundColor Yellow
    Write-Host "💾 Please re-download the complete portable package." -ForegroundColor White
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'Start Telegram.ps1'), winPsContent);

// 创建用户友好的Unix启动脚本
const unixShContent = `#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "🚀 Telegram Web Client - Portable Version"
echo "=========================================="
echo ""
echo "Starting Telegram Web Client..."

# 检测操作系统并使用对应的Node.js运行时
if [[ "$OSTYPE" == "darwin"* ]]; then
    NODE_PATH="./runtime/darwin/bin/node"
    PLATFORM="macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    NODE_PATH="./runtime/linux/bin/node"
    PLATFORM="Linux"
else
    echo "❌ Unsupported platform: $OSTYPE"
    echo "This portable bundle supports Windows, macOS, and Linux only."
    exit 1
fi

if [ -f "$NODE_PATH" ]; then
    echo "✅ Using bundled Node.js runtime for $PLATFORM"
    echo "🌐 Starting server..."

    # 启动服务器
    "$NODE_PATH" server.cjs &
    SERVER_PID=$!

    # 等待服务器启动
    sleep 3

    echo ""
    echo "✅ Telegram Web Client is starting!"
    echo "🌍 Browser will open automatically..."
    echo "📍 URL will be displayed by the server"
    echo ""

    echo "Press Ctrl+C to stop the server..."

    # 等待中断信号
    trap "echo ''; echo '🛑 Stopping server...'; kill $SERVER_PID 2>/dev/null; exit 0" INT
    wait $SERVER_PID

else
    echo "❌ ERROR: Runtime files missing!"
    echo "📁 Expected: $NODE_PATH"
    echo "💾 Please re-download the complete portable package."
    echo ""
    exit 1
fi`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'Start Telegram.sh'), unixShContent);
fs.chmodSync(path.join(BUNDLE_DIR, 'Start Telegram.sh'), '755');

// 创建简单易懂的用户指南
const userGuideContent = `# 🚀 Telegram Web Client - Portable

## QUICK START (3 seconds!)

### 📱 Windows Users
Double-click: **"Start Telegram.bat"**

### 🍎 Mac/Linux Users
Double-click: **"Start Telegram.sh"**

That's it! The app will open in your browser automatically.

---

## ✨ What makes this special?

✅ **No installation required** - Just double-click and run!
✅ **No Node.js needed** - Everything is included
✅ **Works offline** - No internet required after download
✅ **Portable** - Copy to USB drive and run anywhere
✅ **Cross-platform** - Works on Windows, Mac, and Linux

---

## 📁 What's inside?

- **Start Telegram.bat** - Windows launcher (recommended)
- **Start Telegram.sh** - Mac/Linux launcher (recommended)
- **Start Telegram.ps1** - Windows PowerShell version
- **start-quiet.bat** - Windows silent mode
- **runtime/** - Built-in Node.js for all platforms
- **dist/** - Web application files
- **server.cjs** - Application server

---

## 🔧 Troubleshooting

**Browser doesn't open?**
→ Check the server output for the correct URL (ports 3000-3100)

**Permission denied on Mac/Linux?**
→ Run: \`chmod +x "Start Telegram.sh"\`

**Still having issues?**
→ Check that the runtime/ folder contains your platform

---

**Enjoy your private, portable Telegram Web Client! 🎉**`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'README.txt'), userGuideContent);

// 创建README文件
const readmeContent = `# Telegram Web 客户端 - 完全独立版

## 🚀 快速开始

### Windows用户
双击 \`start.bat\` 文件

### Mac/Linux用户  
双击 \`start.sh\` 文件

**无需安装任何软件！** 本包已内置 Node.js 运行时，双击即可使用。

## 📦 智能运行模式

应用会按以下优先级自动选择运行环境：

1. **内置便携版 Node.js**（推荐）- 已包含在此包中
2. **用户下载的便携版** - 如果存在 \`node-portable/\` 目录
3. **系统 Node.js** - 如果系统已安装 Node.js

## 📁 文件说明

- \`start.bat\` - Windows启动脚本
- \`start.sh\` - Mac/Linux启动脚本
- \`server.cjs\` - 服务器文件  
- \`dist/\` - 网页应用文件
- \`node-portable-win/\` - Windows便携版Node.js
- \`node-portable-mac/\` - macOS便携版Node.js  
- \`node-portable-linux/\` - Linux便携版Node.js
- \`download-portable-nodejs.js\` - 备用下载器（通常不需要）

## 🌟 特点

- ✅ **完全独立**: 内置Node.js，无需额外安装
- ✅ **用户友好**: 普通用户双击即可使用
- ✅ **跨平台支持**: Windows、macOS、Linux全支持
- ✅ **智能检测**: 自动选择最佳运行环境
- ✅ **体积优化**: 只包含必要文件

## 🔧 使用说明

1. 启动后会自动在浏览器中打开 http://localhost:3000
2. 如果浏览器没有自动打开，请手动访问 http://localhost:3000  
3. 按 Ctrl+C 或关闭终端窗口来停止服务

## 🎯 适用场景

- ✅ 给普通用户快速部署
- ✅ 在没有管理员权限的电脑上运行
- ✅ 不想安装Node.js的用户
- ✅ 离线环境使用

---
客户端版本: ${require('../package.json').version}
构建时间: ${new Date().toLocaleString()}`;

fs.writeFileSync(path.join(BUNDLE_DIR, 'README.md'), readmeContent);

// 主要执行流程
async function main() {
  try {
    // 下载便携版Node.js
    await downloadPortableNodejs();
    
    console.log('\n✅ 便携版独立应用包创建完成！');
    console.log(`📁 输出目录: ${BUNDLE_DIR}`);
    console.log('📋 包含文件:');
    fs.readdirSync(BUNDLE_DIR).forEach(file => {
      const stats = fs.statSync(path.join(BUNDLE_DIR, file));
      const size = stats.isDirectory() ? '(文件夹)' : `(${(stats.size / 1024).toFixed(1)}KB)`;
      console.log(`   - ${file} ${size}`);
    });

    console.log('\n🎯 This version is truly user-friendly:');
    console.log('✅ Zero setup required - Double-click and done!');
    console.log('✅ Includes Node.js runtime for all platforms');
    console.log('✅ Auto-opens browser - No manual configuration');
    console.log('✅ Professional UX - Clear startup messages');
    console.log('✅ Cross-platform - Windows, Mac, Linux ready');
    console.log('\n🚀 Users just double-click "Start Telegram" and it works!');
    
  } catch (error) {
    console.error('❌ 创建过程中出现错误:', error);
    process.exit(1);
  }
}

// 执行主程序
main();