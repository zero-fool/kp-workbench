"""PyInstaller 打包入口（从项目根目录运行；打包见 build_exe.bat）。"""
from apple_pie.gui import main

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # 窗口版（console=False）崩溃时 Windows 无任何提示，留痕到 exe 旁供排查
        import traceback
        from pathlib import Path

        from apple_pie.paths import app_dir

        try:
            (app_dir() / "apple_pie_crash.log").write_text(traceback.format_exc(), encoding="utf-8")
        except OSError:
            pass
        raise
