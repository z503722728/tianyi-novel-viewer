#!/usr/bin/env python3
"""
天意小说 → GitHub Pages 同步脚本（多书版）
用法：
  python3 sync_to_github.py --project-dir /path/to/novel --password "密钥" [--book-id "自定义ID"]

数据结构：
  data/
    books.json          # 书目录（明文）
    sentinel.enc        # 全局密钥验证
    {book_id}/
      meta.json         # 明文摘要（章节数/更新时间）
      index.enc         # 全量加密数据（世界观+章节+时间轴）
"""
import os, sys, json, glob, argparse, subprocess, base64, secrets, re
from pathlib import Path
from datetime import datetime

# ===== 加密（AES-256-GCM + PBKDF2，与前端 crypto.js 完全对应） =====
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

def derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100000)
    return kdf.derive(password.encode('utf-8'))


# ===== 段落切块（给前端锚点跳转用）=====
def _split_blocks(content: str) -> list:
    """
    把章节正文按段落切成 blocks 列表。
    每块：{"id": "block-N", "type": "heading"|"paragraph", "text": "..."}
    空行跳过，标题(#开头)单独成块。
    """
    blocks = []
    idx = 0
    for line in content.split('\n'):
        line_s = line.strip()
        if not line_s:
            continue
        if line_s.startswith('#'):
            btype = 'heading'
            text  = line_s.lstrip('#').strip()
        else:
            btype = 'paragraph'
            text  = line_s
        blocks.append({"id": f"block-{idx}", "type": btype, "text": text})
        idx += 1
    return blocks

def encrypt_aes_gcm(plaintext: str, password: str) -> str:
    """格式：base64(salt[16] + iv[12] + ciphertext+tag[16])"""
    if not HAS_CRYPTO:
        raise RuntimeError("请先安装：pip install cryptography")
    salt = secrets.token_bytes(16)
    iv   = secrets.token_bytes(12)
    key  = derive_key(password, salt)
    ct_tag = AESGCM(key).encrypt(iv, plaintext.encode('utf-8'), None)
    return base64.b64encode(salt + iv + ct_tag).decode('ascii')

def make_book_id(world_name: str) -> str:
    """从世界名生成安全的目录名"""
    safe = re.sub(r'[^\w\u4e00-\u9fff-]', '_', world_name).strip('_')
    return safe or 'novel'

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

    # 时间轴（完整结构，不再展平，前端分类展示）
    for tl_path in [p / "history" / "timeline.json", p / "timeline.json"]:
        if tl_path.exists():
            with open(tl_path, encoding='utf-8') as f:
                tl = json.load(f)
            if isinstance(tl, dict):
                result["eras"]             = tl.get("eras", [])
                result["power_shifts"]     = tl.get("power_shifts", [])
                result["battle_milestones"]= tl.get("battle_milestones", [])
                result["character_fates"]  = tl.get("character_fates", [])
                result["history_nodes"]    = tl.get("history_nodes", [])
                result["history_archetypes"]= tl.get("history_archetypes", [])
                # 兼容旧 timeline 字段（展平供时间轴页使用）
                nodes = []
                for era in result["eras"]:
                    nodes.append({"year": era.get("name",""), "event": era.get("macro_trend",""),
                        "description": f"第{era['chapter_range'][0]}~{era['chapter_range'][1]}章" if era.get("chapter_range") else "",
                        "type": "era"})
                for ps in result["power_shifts"]:
                    nodes.append({"year": ps.get("name",""), "event": ps.get("outcome",""),
                        "description": "、".join(ps.get("trigger_conditions") or [])[:80],
                        "type": "power_shift"})
                for bm in result["battle_milestones"]:
                    nodes.append({"year": bm.get("name",""), "event": bm.get("outcome",""),
                        "description": f"策略：{bm.get('strategy_archetype','')}",
                        "type": "battle"})
                result["timeline"] = nodes
            else:
                result["timeline"] = tl if isinstance(tl, list) else []
            total = sum(len(result.get(k,[])) for k in ["eras","power_shifts","battle_milestones","character_fates","history_nodes"])
            print(f"  ✅ 历史数据: eras={len(result['eras'])} power_shifts={len(result['power_shifts'])} battles={len(result['battle_milestones'])} fates={len(result['character_fates'])} nodes={len(result['history_nodes'])}")
            break

    # 章节
    chap_txts = sorted(glob.glob(str(p / "content" / "chapters" / "ch_*.txt")))
    bp_dir = p / "plan" / "blueprints"
    for txt_path in chap_txts:
        ch_id  = Path(txt_path).stem
        ch_num = int(ch_id.replace("ch_", ""))
        with open(txt_path, encoding='utf-8') as f:
            raw = f.read()
        content    = raw.split("---CHANGES---")[0].strip()
        word_count = len(content)
        title = f"第{ch_num}章"
        for line in content.split('\n')[:3]:
            line = line.strip().lstrip('#').strip()
            if line:
                title = line
                break
        # 段落切块：每块加 block_id，供前端锚点跳转
        blocks = _split_blocks(content)
        ch_data = {
            "chapter_id": ch_id, "chapter_num": ch_num,
            "title": title, "content": content,
            "blocks": blocks,
            "word_count": word_count,
            "summary": content[:100].replace('\n', ' ') + '…',
        }
        bp_file = bp_dir / f"{ch_id}.json"
        if bp_file.exists():
            try:
                with open(bp_file, encoding='utf-8') as f:
                    bp = json.load(f)
                ch_data.update({
                    "chapter_type":      bp.get("chapter_type", "main_pov"),
                    "pov_character":     bp.get("pov_character", ""),
                    "strategy_core":     bp.get("strategy_core", ""),
                    "cost_this_chapter": bp.get("cost_this_chapter", ""),
                })
                if bp.get("summary"):
                    ch_data["summary"] = bp["summary"]
            except Exception as e:
                print(f"  ⚠️  蓝图读取失败 {bp_file}: {e}")
        result["chapters"].append(ch_data)
        print(f"  ✅ 章节: {title}（{word_count}字）")
    return result

# ===== 写入 data/{book_id}/ =====
def write_book_data(data: dict, password: str, viewer_dir: str, book_id: str):
    book_dir = Path(viewer_dir) / "data" / book_id
    book_dir.mkdir(parents=True, exist_ok=True)
    # 把 book_id 写入加密数据，前端路由依赖它
    data["book_id"] = book_id

    # 加密主数据
    index_json = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    enc_index  = encrypt_aes_gcm(index_json, password)
    (book_dir / "index.enc").write_text(enc_index + "\n", encoding='utf-8')
    print(f"  ✅ data/{book_id}/index.enc ({len(enc_index)/1024:.1f} KB)")

    # 明文摘要
    meta = {
        "book_id":       book_id,
        "world_name":    data.get("world_name", ""),
        "chapter_count": len(data.get("chapters", [])),
        "total_words":   sum(c.get("word_count", 0) for c in data.get("chapters", [])),
        "updated_at":    data.get("updated_at", ""),
    }
    (book_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"  ✅ data/{book_id}/meta.json")
    return meta

# ===== 更新书目录 books.json =====
def update_books_json(viewer_dir: str, new_meta: dict):
    books_file = Path(viewer_dir) / "data" / "books.json"
    books = []
    if books_file.exists():
        try:
            books = json.loads(books_file.read_text(encoding='utf-8'))
        except Exception:
            books = []
    # 更新或插入
    found = False
    for i, b in enumerate(books):
        if b.get("book_id") == new_meta["book_id"]:
            books[i] = new_meta
            found = True
            break
    if not found:
        books.append(new_meta)
    books_file.write_text(json.dumps(books, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"  ✅ data/books.json ({len(books)} 本书)")

# ===== 更新 sentinel =====
def ensure_sentinel(viewer_dir: str, password: str):
    sentinel_file = Path(viewer_dir) / "data" / "sentinel.enc"
    sentinel = "TIANYI_OK_" + datetime.now().strftime("%Y%m%d")
    sentinel_file.write_text(encrypt_aes_gcm(sentinel, password) + "\n", encoding='utf-8')
    print(f"  ✅ data/sentinel.enc")

# ===== Git 推送 =====
def git_push(viewer_dir: str, message: str) -> bool:
    def run(cmd):
        r = subprocess.run(cmd, cwd=viewer_dir, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  ⚠️  {' '.join(cmd)}: {r.stderr.strip()}")
        return r.returncode == 0
    run(["git", "config", "http.sslBackend", "openssl"])
    run(["git", "add", "data/"])
    status = subprocess.run(["git", "status", "--porcelain", "data/"],
                            cwd=viewer_dir, capture_output=True, text=True)
    if not status.stdout.strip():
        print("  ℹ️  数据无变化，跳过提交")
        return True
    run(["git", "commit", "-m", message])
    ok = run(["git", "push", "origin", "main"])
    if ok:
        # 获取最新 commit hash，更新 index.html 版本号（破缓存）
        r = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                           cwd=viewer_dir, capture_output=True, text=True)
        new_hash = r.stdout.strip()
        if new_hash:
            _bump_version(viewer_dir, new_hash)
            run(["git", "add", "index.html", "404.html"])
            r2 = subprocess.run(["git", "status", "--porcelain", "index.html", "404.html"],
                                cwd=viewer_dir, capture_output=True, text=True)
            if r2.stdout.strip():
                run(["git", "commit", "-m", f"chore: bump asset version {new_hash}"])
                run(["git", "push", "origin", "main"])
    return ok

def _bump_version(viewer_dir: str, new_hash: str):
    """更新 index.html 和 404.html 里 ?v=xxxx 版本号"""
    import re
    for fname in ('index.html', '404.html'):
        html_path = Path(viewer_dir) / fname
        if not html_path.exists():
            continue
        html = html_path.read_text(encoding='utf-8')
        html = re.sub(r'\?v=[0-9a-f]+', f'?v={new_hash}', html)
        html_path.write_text(html, encoding='utf-8')
        print(f"  ✅ {fname} 版本号 → ?v={new_hash}")

# ===== 主流程 =====
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--password",    required=True)
    parser.add_argument("--book-id",     default=None, help="自定义书ID（默认用世界名）")
    parser.add_argument("--repo-dir",    default="/projects/tianyi-novel-viewer")
    parser.add_argument("--no-push",     action="store_true")
    args = parser.parse_args()

    if not HAS_CRYPTO:
        print("📦 安装 cryptography...")
        subprocess.run([sys.executable, "-m", "pip", "install", "cryptography", "-q"])
        os.execv(sys.executable, [sys.executable] + sys.argv)

    print("=" * 60)
    print("  天意小说 → GitHub Pages 同步（多书版）")
    print("=" * 60)

    print(f"\n📖 读取项目: {args.project_dir}")
    data    = load_novel_project(args.project_dir)
    book_id = args.book_id or make_book_id(data.get("world_name", "novel"))
    print(f"   书ID: {book_id}，章节: {len(data['chapters'])} 章")

    print(f"\n🔐 加密写入 → {args.repo_dir}/data/{book_id}/")
    new_meta = write_book_data(data, args.password, args.repo_dir, book_id)
    update_books_json(args.repo_dir, new_meta)
    ensure_sentinel(args.repo_dir, args.password)

    if args.no_push:
        print("\n✅ 文件生成完毕（--no-push）")
        return

    print(f"\n🚀 提交到 GitHub...")
    msg = f"sync: [{book_id}] {len(data['chapters'])}章 {data['updated_at']}"
    ok  = git_push(args.repo_dir, msg)
    if ok:
        print(f"\n✅ 同步完成！")
        print(f"   访问: https://z503722728.github.io/tianyi-novel-viewer/")
    else:
        print(f"\n⚠️  push 失败，请检查 git 凭据")

if __name__ == "__main__":
    main()
