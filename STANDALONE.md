# Telegram Web 客户端 - 独立应用

## 🚀 快速开始

### 开发测试
```bash
npm run standalone:run
```

### 打包独立应用
```bash
npm run standalone:package
```

## 📦 打包说明

运行 `npm run standalone:package` 后，会生成：

1. **dist-standalone-bundle/** - 完整的独立应用包
   - `start.bat` - Windows启动脚本
   - `start.sh` - Mac/Linux启动脚本  
   - `standalone-server-win.exe` - Windows可执行文件
   - `standalone-server-macos` - macOS可执行文件
   - `standalone-server-linux` - Linux可执行文件
   - `dist/` - Web应用文件
   - `README.md` - 使用说明

## 🎯 分发方式

### 方式一：完整包分发
将整个 `dist-standalone-bundle/` 文件夹打包成ZIP发给用户：
- Windows用户：解压后双击 `start.bat`
- Mac/Linux用户：解压后双击 `start.sh`

### 方式二：单文件分发（仅服务器）
只分发对应平台的可执行文件：
- `standalone-server-win.exe` (Windows)
- `standalone-server-macos` (macOS)  
- `standalone-server-linux` (Linux)

⚠️ **注意**: 单文件方式需要用户首次运行时联网下载依赖和构建

## 🔧 工作原理

1. **首次运行**: 自动检查并构建web应用 (dev环境)
2. **启动服务**: 在本地3000端口启动HTTP服务器
3. **自动打开**: 自动在默认浏览器中打开应用
4. **本地运行**: 完全本地运行，无需互联网（构建后）

## 📋 技术详情

- **构建环境**: dev (开发环境，包含调试信息)
- **服务器**: Node.js 内置HTTP模块 (无额外依赖)
- **端口**: 3000 (可在standalone-server.js中修改)
- **打包工具**: pkg (将Node.js应用打包为可执行文件)

## 🛠️ 自定义配置

### 修改端口
编辑 `standalone-server.js` 中的 `PORT` 常量：
```javascript
const PORT = 8080; // 改为你想要的端口
```

### 修改构建环境
编辑 `standalone-server.js` 中的构建命令：
```javascript
exec('npm run build:production', ...) // 改为生产环境
```

## 📱 系统要求

- **Windows**: Windows 7 及以上
- **macOS**: macOS 10.12 及以上  
- **Linux**: 现代Linux发行版
- **浏览器**: Chrome, Firefox, Safari, Edge 等现代浏览器

## 🔍 故障排除

### 端口占用
如果3000端口被占用，会显示错误信息。解决方案：
1. 关闭占用3000端口的其他应用
2. 或修改standalone-server.js中的端口号

### 构建失败  
确保已安装Node.js和npm依赖：
```bash
npm install
```

### 浏览器未自动打开
手动在浏览器中访问: http://localhost:3000