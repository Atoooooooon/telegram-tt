#!/usr/bin/env node

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { exec } = require('child_process');

const DEFAULT_PORT = 3000;
let PORT = DEFAULT_PORT;
const DIST_PATH = path.join(__dirname, 'dist');

console.log('🚀 启动 Telegram Web 客户端...');

// MIME类型映射
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

// 检查是否需要构建
if (!fs.existsSync(DIST_PATH)) {
  console.log('📦 首次运行，正在构建应用...');
  console.log('请稍候，这可能需要几分钟...');
  
  exec('npm run build:dev', (error, stdout, stderr) => {
    if (error) {
      console.error('❌ 构建失败:', error);
      console.error('请确保已安装依赖: npm install');
      process.exit(1);
    }
    console.log('✅ 构建完成！');
    startServer();
  });
} else {
  startServer();
}

// 检查端口是否可用
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = http.createServer();

    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.on('error', () => {
      resolve(false);
    });
  });
}

// 寻找可用端口
async function findAvailablePort(startPort = DEFAULT_PORT) {
  for (let port = startPort; port <= startPort + 100; port++) {
    if (await checkPortAvailable(port)) {
      return port;
    }
  }
  throw new Error('No available port found');
}

async function startServer() {
  try {
    // 寻找可用端口
    PORT = await findAvailablePort();
    console.log(`🔍 Using port ${PORT}`);

    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url);
      let pathname = parsedUrl.pathname;

      // 默认文件
      if (pathname === '/') {
        pathname = '/index.html';
      }

      const filePath = path.join(DIST_PATH, pathname);
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      // 检查文件是否存在
      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
          // 文件不存在，对于SPA应用返回index.html
          const indexPath = path.join(DIST_PATH, 'index.html');
          fs.readFile(indexPath, (err, content) => {
            if (err) {
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('404 Not Found');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
          });
          return;
        }

        // 读取并返回文件
        fs.readFile(filePath, (err, content) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('500 Internal Server Error');
            return;
          }

          res.writeHead(200, { 'Content-Type': mimeType });
          res.end(content);
        });
      });
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`✅ Telegram Web Client started successfully!`);
      console.log(`🌐 URL: http://localhost:${PORT}`);
      console.log(`📱 Open the above URL in your browser`);
      console.log(`🛑 Press Ctrl+C to stop the server`);

      // 自动打开浏览器
      openBrowser(`http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
      console.error('❌ Server error:', err.message);
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  Port ${PORT} is in use, trying next port...`);
        PORT++;
        startServer();
      }
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    console.log('💡 Try running as administrator or check if other applications are using ports 3000-3100');
    process.exit(1);
  }
}

// 自动打开浏览器
function openBrowser(url) {
  const start = process.platform === 'darwin' ? 'open' :
                process.platform === 'win32' ? 'start' : 'xdg-open';

  setTimeout(() => {
    exec(`${start} ${url}`, (err) => {
      if (err) {
        console.log(`💡 Please manually open: ${url}`);
      }
    });
  }, 1500);
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n👋 正在关闭服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 正在关闭服务器...');
  process.exit(0);
});