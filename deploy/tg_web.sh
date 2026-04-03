#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=""

resolve_app_dir() {
    if [ -f "$SCRIPT_DIR/server/index.mjs" ] || [ -f "$SCRIPT_DIR/server.cjs" ]; then
        APP_DIR="$SCRIPT_DIR"
        return 0
    fi

    local parent_dir
    parent_dir="$(cd "$SCRIPT_DIR/.." && pwd)"
    if [ -f "$parent_dir/server/index.mjs" ] || [ -f "$parent_dir/server.cjs" ]; then
        APP_DIR="$parent_dir"
        return 0
    fi

    echo "❌ 无法定位项目目录"
    echo "📁 当前脚本目录: $SCRIPT_DIR"
    echo "💡 请将脚本放在项目根目录，或放在项目根目录下的 deploy/ 目录中执行"
    exit 1
}

resolve_app_dir
cd "$APP_DIR"

FRONTEND_PID_FILE="./telegram-web.pid"
BACKEND_PID_FILE="./telegram-backend.pid"
LOG_DIR="./logs"
FRONTEND_LOG_FILE="$LOG_DIR/telegram-web.log"
BACKEND_LOG_FILE="$LOG_DIR/backend.log"

mkdir -p "$LOG_DIR"

NODE_PATH=""
PLATFORM=""

show_help() {
    echo ""
    echo "🚀 Telegram Web Client - Portable Version"
    echo "=========================================="
    echo ""
    echo "用法: $0 [start|stop|restart|status|logs] [frontend|backend|all]"
    echo ""
    echo "命令:"
    echo "  start    - 启动服务"
    echo "  stop     - 停止服务"
    echo "  restart  - 重启服务"
    echo "  status   - 查看运行状态"
    echo "  logs     - 查看实时日志"
    echo ""
    echo "范围:"
    echo "  frontend - 仅 Telegram Web 前端服务"
    echo "  backend  - 仅 Fastify 后端服务"
    echo "  all      - 默认, 同时操作前端和后端"
    echo ""
}

detect_platform() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        PLATFORM="macOS"
        if [ -f "./runtime/darwin/bin/node" ]; then
            NODE_PATH="./runtime/darwin/bin/node"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        PLATFORM="Linux"
        if [ -f "./runtime/linux/bin/node" ]; then
            NODE_PATH="./runtime/linux/bin/node"
        fi
    else
        echo "❌ 不支持的平台: $OSTYPE"
        exit 1
    fi

    if [ -z "$NODE_PATH" ]; then
        local system_node
        system_node="$(command -v node || true)"
        if [ -n "$system_node" ]; then
            NODE_PATH="$system_node"
        else
            echo "❌ 未找到可用的 Node.js 运行时"
            exit 1
        fi
    fi
}

is_pid_running() {
    local pid_file="$1"

    if [ ! -f "$pid_file" ]; then
        return 1
    fi

    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -z "$pid" ]; then
        rm -f "$pid_file"
        return 1
    fi

    if ps -p "$pid" > /dev/null 2>&1; then
        return 0
    fi

    rm -f "$pid_file"
    return 1
}

start_process() {
    local name="$1"
    local command_path="$2"
    local pid_file="$3"
    local log_file="$4"

    if [ ! -f "$command_path" ]; then
        echo "⚠️  跳过 $name: 未找到入口文件 $command_path"
        return 0
    fi

    if is_pid_running "$pid_file"; then
        echo "⚠️  $name 已在运行中 (PID: $(cat "$pid_file"))"
        return 0
    fi

    echo "🚀 正在启动 $name..."
    nohup "$NODE_PATH" "$command_path" >> "$log_file" 2>&1 &
    local pid=$!
    echo "$pid" > "$pid_file"

    sleep 3

    if is_pid_running "$pid_file"; then
        echo "✅ $name 启动成功 (PID: $pid)"
        return 0
    fi

    echo "❌ $name 启动失败，请检查日志: $log_file"
    rm -f "$pid_file"
    return 1
}

stop_process() {
    local name="$1"
    local pid_file="$2"

    if ! is_pid_running "$pid_file"; then
        echo "⚠️  $name 未在运行"
        return 0
    fi

    local pid
    pid="$(cat "$pid_file")"
    echo "🛑 正在停止 $name (PID: $pid)..."

    kill "$pid" 2>/dev/null || true

    local count=0
    while ps -p "$pid" > /dev/null 2>&1 && [ "$count" -lt 10 ]; do
        sleep 1
        count=$((count + 1))
    done

    if ps -p "$pid" > /dev/null 2>&1; then
        echo "⚡ 强制停止 $name..."
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi

    rm -f "$pid_file"
    echo "✅ $name 已停止"
    return 0
}

start_frontend() {
    start_process "Telegram Web 前端" "./server.cjs" "$FRONTEND_PID_FILE" "$FRONTEND_LOG_FILE"
}

start_backend() {
    start_process "Telegram Web 后端" "./server/index.mjs" "$BACKEND_PID_FILE" "$BACKEND_LOG_FILE"
}

stop_frontend() {
    stop_process "Telegram Web 前端" "$FRONTEND_PID_FILE"
}

stop_backend() {
    stop_process "Telegram Web 后端" "$BACKEND_PID_FILE"
}

show_single_status() {
    local name="$1"
    local pid_file="$2"
    local log_file="$3"

    if is_pid_running "$pid_file"; then
        echo "✅ $name: 运行中 (PID: $(cat "$pid_file"))"
        echo "📝 日志: $log_file"
    else
        echo "❌ $name: 未运行"
    fi
}

show_status() {
    echo ""
    echo "📊 Telegram Web Client 状态"
    echo "=========================="
    show_single_status "前端" "$FRONTEND_PID_FILE" "$FRONTEND_LOG_FILE"
    show_single_status "后端" "$BACKEND_PID_FILE" "$BACKEND_LOG_FILE"
    echo ""
}

show_logs() {
    local target="${1:-all}"

    echo "📝 实时日志 (按 Ctrl+C 退出):"
    echo "=========================="

    case "$target" in
        frontend)
            touch "$FRONTEND_LOG_FILE"
            tail -f "$FRONTEND_LOG_FILE"
            ;;
        backend)
            touch "$BACKEND_LOG_FILE"
            tail -f "$BACKEND_LOG_FILE"
            ;;
        all)
            touch "$FRONTEND_LOG_FILE" "$BACKEND_LOG_FILE"
            tail -f "$FRONTEND_LOG_FILE" "$BACKEND_LOG_FILE"
            ;;
        *)
            echo "❌ 未知日志范围: $target"
            exit 1
            ;;
    esac
}

start_service() {
    local target="${1:-all}"

    echo ""
    echo "🚀 Telegram Web Client - Portable Version"
    echo "=========================================="
    echo ""

    detect_platform
    echo "✅ 使用 $PLATFORM 的 Node.js 运行时: $NODE_PATH"

    local failed=0
    case "$target" in
        frontend)
            start_frontend || failed=1
            ;;
        backend)
            start_backend || failed=1
            ;;
        all)
            start_frontend || failed=1
            start_backend || failed=1
            ;;
        *)
            echo "❌ 未知范围: $target"
            exit 1
            ;;
    esac

    return "$failed"
}

stop_service() {
    local target="${1:-all}"

    case "$target" in
        frontend)
            stop_frontend
            ;;
        backend)
            stop_backend
            ;;
        all)
            stop_backend
            stop_frontend
            ;;
        *)
            echo "❌ 未知范围: $target"
            exit 1
            ;;
    esac
}

restart_service() {
    local target="${1:-all}"
    echo "🔄 重启 Telegram Web Client..."
    stop_service "$target"
    sleep 2
    start_service "$target"
}

COMMAND="${1:-start}"
TARGET="${2:-all}"

case "$COMMAND" in
    start)
        start_service "$TARGET"
        ;;
    stop)
        stop_service "$TARGET"
        ;;
    restart)
        restart_service "$TARGET"
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$TARGET"
        ;;
    help|-h|--help)
        show_help
        ;;
    *)
        echo "❌ 未知命令: $COMMAND"
        show_help
        exit 1
        ;;
esac
