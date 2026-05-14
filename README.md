# 天意·小说世界 阅读器

> AI 创作世界观档案，移动端加密阅读站

## 在线访问

🔗 **https://z503722728.github.io/tianyi-novel-viewer/**

> 需要密钥才可解锁阅读，密钥由作者提供。

## 功能特性

- 📱 **移动端优化**：深色主题，底部导航，丝滑滚动
- 🔐 **AES-256-GCM 加密**：PBKDF2 密钥派生，密钥仅存在用户内存中
- 📖 **完整内容**：章节正文、世界观设定、角色档案、势力格局、历史时间轴
- 🎬 **叙事元数据**：章节类型（正线/暗线）、视角人物、谋略核心、代价标注
- 🔄 **自动更新**：每次 push 自动触发 GitHub Pages 部署（1-2分钟生效）
- 📲 **PWA 支持**：可添加到主屏幕，离线缓存

## 同步数据

```bash
cd /projects/tianyi-novel-viewer
python3 scripts/sync_to_github.py \
  --project-dir /projects/tianyi-writer/output/novels/novel_xxx \
  --password "你的密钥"
```

## 加密原理

```
用户输入密钥
    ↓
PBKDF2(SHA-256, 100000次) → AES-256 密钥
    ↓
AES-256-GCM 解密（salt[16] + iv[12] + ciphertext + tag[16]）
    ↓
JSON 明文 → 渲染页面
```

密钥**不存储在任何地方**，页面关闭后立即清除，重新打开需重新输入。

## 技术栈

- 纯静态 HTML/CSS/JS（无框架依赖）
- Web Crypto API（浏览器原生 AES-GCM）
- GitHub Pages + GitHub Actions 自动部署

## 文件结构

```
├── index.html          # 主页面
├── assets/
│   ├── style.css       # 深色移动端样式
│   ├── crypto.js       # AES-256-GCM 加密模块
│   └── app.js          # 应用逻辑
├── data/
│   ├── sentinel.enc    # 密钥验证哨兵（加密）
│   ├── index.enc       # 全量数据（加密）
│   └── meta.json       # 明文摘要（章节数/更新时间）
├── scripts/
│   └── sync_to_github.py  # 本地同步脚本
└── .github/workflows/
    └── deploy.yml      # GitHub Actions 自动部署
```
