#!/usr/bin/env python3
"""
天意小说 · 一键同步快捷脚本（多书版）
用法：
  python3 sync.py                          # 同步默认小说，密钥 tianyi2026
  python3 sync.py --project /path/to/book  # 指定小说目录
  python3 sync.py --password "你的密钥"    # 指定密钥
  python3 sync.py --book-id "自定义ID"     # 强制指定书 ID（默认用世界名）
"""
import subprocess, sys, os

PROJECT_DIR  = "/home/hjx/projects/tianyi-writer/output/novels/novel_v4_test"
PASSWORD     = "tianyi2026"
REPO_DIR     = os.path.dirname(os.path.abspath(__file__))

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--project",  default=PROJECT_DIR)
    p.add_argument("--password", default=PASSWORD)
    p.add_argument("--book-id",  default=None)
    p.add_argument("--no-push",  action="store_true")
    args = p.parse_args()

    cmd = [
        sys.executable, "scripts/sync_to_github.py",
        "--project-dir", args.project,
        "--password", args.password,
        "--repo-dir", REPO_DIR,
    ]
    if args.book_id:
        cmd += ["--book-id", args.book_id]
    if args.no_push:
        cmd += ["--no-push"]

    subprocess.run(cmd, cwd=REPO_DIR)
