#!/usr/bin/env python3
"""
天意小说 → GitHub Pages 同步脚本
用法：
  python3 sync_to_github.py --project-dir /path/to/novel --password "你的密钥" [--repo-dir /path/to/tianyi-novel-viewer]

功能：
  1. 读取天意写作系统生成的 world_data.json / ch_*.txt / timeline.json
  2. 构建统一 index.json（章节+世界观+时间轴）
  3. 用 AES-256-GCM（PBKDF2 密钥派生）加密
  4. 写入 viewer 仓库的 data/ 目录
  5. git commit + push → GitHub Pages 自动更新
"""
import os, sys, json, glob, argparse, subprocess, base64, secrets, hashlib
from pathlib import Path
from datetime import datetime

# ===== 加密（与前端 crypto.js 完全对应） =====
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

def derive_key(password: str, salt: bytes) -> bytes:
    """PBKDF2-SHA256, 100000 次，32 字节密钥（与 JS 端一致）"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    return kdf.derive(password.encode('utf-8'))

def encrypt_aes_gcm(plaintext: str, password: str) -> str:
    """
    加密格式（base64）：salt[16] + iv[12] + ciphertext+tag[16]
    完全对应前端 crypto.js 的 encrypt() 函数
    """
    if not HAS_CRYPTO:
        raise RuntimeError("请先安装：pip install cryptography")
    salt = secrets.token_bytes(16)
    iv   = secrets.token_bytes(12)
    key  = derive_key(password, salt)
    aesgcm = AESGCM(key)
    ct_tag = aesgcm.encrypt(iv, plaintext.encode('utf-8'), None)  # ciphertext + tag(16)
    raw = salt + iv + ct_tag
    return base64.b64encode(raw).decode('ascii')

# ===== 读取天意项目数据 =====
def load_novel_project(project_dir: str) -> dict:
    p = Path(project_dir)
    result = {
        "world": None,
        "chapters": [],
        "timeline": [],
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }

    # 世界观
    world_file = p / "world" / "world_data.json"
    if world_file.exists():
        with open(world_file, encoding='utf-8') as f:
            result["world"] = json.load(f)
            result["world_name"] = result["world"].get("world_name", "未知世界")
        print(f"  ✅ 世界观: {result['world_name']}")

    # 时间轴
    timeline_file = p / "timeline.json"
    if timeline_file.exists():
        with open(timeline_file, encoding='utf-8') as f:
            tl = json.load(f)
            if isinstance(tl, list):
                result["timeline"] = tl
            elif isinstance(tl, dict):
                result["timeline"] = tl.get("nodes", tl.get("events", []))
        print(f"  ✅ 时间轴: {len(result['timeline'])} 个节点")

    # 章节（读取 ch_*.txt 和对应蓝图 ch_*.json）
    chap_txts = sorted(glob.glob(str(p / "content" / "chapters" / "ch_*.txt")))
    bp_dir    = p / "plan" / "blueprints"

    for txt_path in chap_txts:
        ch_id = Path(txt_path).stem  # e.g. "ch_0001"
        ch_num = int(ch_id.replace("ch_", ""))

        with open(txt_path, encoding='utf-8') as f:
            raw = f.read()
        content = raw.split("---CHANGES---")[0].strip()
        word_count = len(content)

        # 提取标题
        title = f"第{ch_num}章"
        for line in content.split('\n')[:3]:
            line = line.strip().lstrip('#').strip()
            if line:
                title = line
                break

        ch_data = {
            "chapter_id": ch_id,
            "chapter_num": ch_num,
            "title": title,
            "content": content,
            "word_count": word_count,
            "summary": content[:100].replace('\n', ' ') + '…',
        }

        # 读取蓝图（额外元数据）
        bp_file = bp_dir / f"{ch_id}.json"
        if bp_file.exists():
            try:
                with open(bp_file, encoding='utf-8') as f:
                    bp = json.load(f)
                ch_data["chapter_type"]     = bp.get("chapter_type", "main_pov")
                ch_data["pov_character"]    = bp.get("pov_character", "")
                ch_data["strategy_core"]    = bp.get("strategy_core", "")
                ch_data["cost_this_chapter"]= bp.get("cost_this_chapter", "")
                if bp.get("summary"):
                    ch_data["summary"] = bp["summary"]
            except Exception as e:
                print(f"  ⚠️  蓝图读取失败 {bp_file}: {e}")

        result["chapters"].append(ch_data)
        print(f"  ✅ 章节: {title}（{word_count}字）")

    return result

# ===== 写入 data/ 目录 =====
def write_encrypted_data(data: dict, password: str, viewer_dir: str):
    data_dir = Path(viewer_dir) / "data"
    data_dir.mkdir(exist_ok=True)

    # 写 sentinel（用于前端验证密钥）
    sentinel = "TIANYI_OK_" + datetime.now().strftime("%Y%m%d")
    enc_sentinel = encrypt_aes_gcm(sentinel, password)
    (data_dir / "sentinel.enc").write_text(enc_sentinel + "\n", encoding='utf-8')
    print(f"  ✅ sentinel 写入")

    # 写主数据 index.enc
    index_json = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    enc_index = encrypt_aes_gcm(index_json, password)
    (data_dir / "index.enc").write_text(enc_index + "\n", encoding='utf-8')
    size_kb = len(enc_index) / 1024
    print(f"  ✅ index.enc 写入（{size_kb:.1f} KB）")

    # 写元信息（明文，供 SEO/爬虫/自己查看）
    meta = {
        "world_name": data.get("world_name", ""),
        "chapter_count": len(data.get("chapters", [])),
        "updated_at": data.get("updated_at", ""),
        "note": "内容已加密，需密钥才可阅读"
    }
    (data_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    print(f"  ✅ meta.json 写入（明文摘要）")

# ===== Git 提交推送 =====
def git_push(viewer_dir: str, message: str):
    env = os.environ.copy()
    def run(cmd):
        r = subprocess.run(cmd, cwd=viewer_dir, capture_output=True, text=True, env=env)
        if r.returncode != 0:
            print(f"  ⚠️  {' '.join(cmd)}: {r.stderr.strip()}")
        return r.returncode == 0

    run(["git", "config", "http.sslBackend", "openssl"])
    run(["git", "add", "data/"])
    # 检查是否有变更
    status = subprocess.run(["git", "status", "--porcelain", "data/"],
                            cwd=viewer_dir, capture_output=True, text=True)
    if not status.stdout.strip():
        print("  ℹ️  数据无变化，跳过提交")
        return True
    run(["git", "commit", "-m", message])
    ok = run(["git", "push", "origin", "main"])
    return ok

# ===== 主流程 =====
def main():
    parser = argparse.ArgumentParser(description="天意小说 → GitHub Pages 同步")
    parser.add_argument("--project-dir",  required=True, help="天意项目目录（含 world/content/plan 等）")
    parser.add_argument("--password",     required=True, help="加密密钥（与 GitHub Pages 阅读密钥一致）")
    parser.add_argument("--repo-dir",     default="/projects/tianyi-novel-viewer", help="viewer 仓库目录")
    parser.add_argument("--no-push",      action="store_true", help="只生成文件，不 push")
    args = parser.parse_args()

    print("=" * 60)
    print("  天意小说 → GitHub Pages 同步")
    print("=" * 60)

    # 安装依赖
    if not HAS_CRYPTO:
        print("📦 安装 cryptography...")
        subprocess.run([sys.executable, "-m", "pip", "install", "cryptography", "-q"])
        os.execv(sys.executable, [sys.executable] + sys.argv)

    print(f"\n📖 读取项目: {args.project_dir}")
    data = load_novel_project(args.project_dir)
    print(f"   世界：{data.get('world_name','?')}，章节：{len(data['chapters'])} 章")

    print(f"\n🔐 加密数据 → {args.repo_dir}/data/")
    write_encrypted_data(data, args.password, args.repo_dir)

    if args.no_push:
        print("\n✅ 文件生成完毕（--no-push，跳过 git push）")
        return

    print(f"\n🚀 提交到 GitHub...")
    msg = f"sync: {data.get('world_name','?')} {len(data['chapters'])}章 {data['updated_at']}"
    ok = git_push(args.repo_dir, msg)
    if ok:
        print(f"\n✅ 同步完成！GitHub Pages 将在 1-2 分钟内更新")
        print(f"   访问地址: https://z503722728.github.io/tianyi-novel-viewer/")
    else:
        print(f"\n⚠️  push 失败，请检查 git 凭据")

if __name__ == "__main__":
    main()
