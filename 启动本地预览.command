#!/bin/bash
# 双击本文件即可启动本地预览，并自动打开浏览器。

cd "$(dirname "$0")/current" || exit 1

PORT=4180

if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "端口 $PORT 已有服务在运行，直接打开浏览器。"
  open "http://127.0.0.1:$PORT/"
  exit 0
fi

echo "正在启动本地预览服务……"
python3 -m http.server $PORT >/dev/null 2>&1 &
SERVER_PID=$!

sleep 2
open "http://127.0.0.1:$PORT/"

echo ""
echo "入口页：  http://127.0.0.1:$PORT/"
echo "后台管理端：http://127.0.0.1:$PORT/admin/"
echo "考生端：  http://127.0.0.1:$PORT/student/"
echo "考官端：  http://127.0.0.1:$PORT/judge/"
echo ""
echo "修改原型后在浏览器刷新即可看到效果。"
echo "要停止服务，关闭这个窗口，或按 Control+C。"

trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM
wait $SERVER_PID
