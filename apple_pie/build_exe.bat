@echo off
chcp 65001 >nul
setlocal
cd /d %~dp0
title 苹果派助手 · 一键打包

echo ============================================
echo   苹果派助手 一键打包（生成 dist\苹果派助手.exe）
echo ============================================

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 python。请先安装 Python 3 并勾选 "Add python.exe to PATH"
    echo        下载: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/3] 安装依赖（pillow + pyinstaller）...
python -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo [错误] 依赖安装失败，可换镜像: python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    pause
    exit /b 1
)

echo [2/3] 打包中（首次约 1-3 分钟）...
python -m PyInstaller --clean --noconfirm applepie.spec
if errorlevel 1 (
    echo [错误] 打包失败，把上方报错截图发我
    pause
    exit /b 1
)

echo [3/3] 完成！双击打开: %~dp0dist\苹果派助手.exe
explorer "%~dp0dist"
pause
