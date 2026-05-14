#!/usr/bin/env python3
"""
快速同步脚本 - 直接运行即可
自动同步最新生成的小说到 GitHub Pages
"""
import subprocess, sys, os
from pathlib import Path

# ===== 配置（修改这里）=====
NOVEL_DIR   = "/projects/tianyi-writer/output/novels"   # 小说输出根目录
VIEWER_DIR  = "/projects/tianyi-novel-viewer"           # viewer 仓库目录
PASSWORD    = "tianyi2026"                               # 阅读密钥（可改）

# 自动找最新的小说目录
def find_latest_novel():
    dirs = sorted(Path(NOVEL_DIR).glob("novel_*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not dirs:
        print("❌ 找不到小说目录")
        sys.exit(1)
    latest = dirs[0]
    print(f"📖 最新小说目录: {latest.name}")
    return str(latest)

if __name__ == "__main__":
    project_dir = find_latest_novel()
    sync_script = Path(VIEWER_DIR) / "scripts" / "sync_to_github.py"
    cmd = [
        sys.executable, str(sync_script),
        "--project-dir", project_dir,
        "--password", PASSWORD,
        "--repo-dir", VIEWER_DIR,
    ]
    subprocess.run(cmd)
