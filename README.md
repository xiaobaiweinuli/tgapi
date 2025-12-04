# Telegram 代理服务

基于 Cloudflare Workers 的 Telegram Bot API 代理服务，支持文件上传和永久直链生成，适合做博客图床和文件分享。

## ✨ 主要特性

- 🔐 **上传密码保护** - 只有授权用户可以上传文件
- 🌍 **下载完全公开** - 生成的链接无需密码，可以直接分享
- 🔗 **友好的链接格式** - 基于频道和消息ID，简洁易读
  - 公开频道：`/file/@channelname/123`
  - 私有频道：`/file/1826585339/123`
- 🚀 **自动获取文件** - 知道消息 ID 就能直接访问，无需预先生成链接（Bot 是管理员时）
- 🔒 **Token 加密保护** - 下载链接中不包含明文 Bot Token
- ♾️ **永久有效** - 链接永不过期
- 📱 **Telegram 原消息跳转** - 可以直接跳转到 Telegram 查看原文件
- 🔄 **支持转发文件** - 为已转发到频道的文件生成下载链接
- 🚀 **CDN 加速** - 利用 Cloudflare 全球边缘节点
- 📦 **大文件支持** - 最大支持 100MB（Cloudflare 免费版）
- 💾 **D1 数据库存储** - 免费 5GB 存储空间

## 🎯 使用场景

- ✅ 博客图床
- ✅ 文档分享
- ✅ 视频托管
- ✅ 音频文件
- ✅ 为历史消息生成直链
- ✅ 任何需要永久直链的文件

## 📋 前置要求

- Cloudflare 账号
- Telegram Bot Token（通过 [@BotFather](https://t.me/BotFather) 创建）
- Telegram 频道或群组（用于存储文件）

## 🚀 快速部署

### 1. 克隆项目

```bash
git clone https://github.com/你的用户名/tgapi.git
cd tgapi
```

### 2. 安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 3. 登录 Cloudflare

```bash
wrangler login
```

### 4. 创建 D1 数据库

```bash
# 创建数据库
wrangler d1 create telegram-files

# 记录输出的 database_id
```

输出示例：
```
✅ Successfully created DB 'telegram-files'
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 5. 配置 `wrangler.toml`

```toml
name = "tgapi"
main = "src/index.js"
compatibility_date = "2024-12-01"

# D1 数据库绑定
[[d1_databases]]
binding = "FILE_DB"
database_name = "telegram-files"
database_id = "你的数据库ID"  # 替换为步骤4中获取的ID
```

### 6. 初始化数据库表

创建 `schema.sql` 文件：

```sql
-- schema.sql
CREATE TABLE IF NOT EXISTS file_mappings (
  file_key TEXT PRIMARY KEY,
  encrypted_data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_created_at ON file_mappings(created_at);
```

执行 SQL：

```bash
wrangler d1 execute telegram-files --file=./schema.sql
```

或者部署后访问：`https://your-worker.workers.dev/init-db`

### 7. 设置环境变量

**方式 1：使用 Cloudflare Dashboard（推荐）**

1. 进入 Cloudflare Dashboard → Workers & Pages
2. 选择你的项目 → Settings → Variables
3. 在 **Production** 和 **Preview** 环境分别添加：
   - `ACCESS_PASSWORD`（类型：Secret 加密）- 上传密码
   - `ENCRYPTION_KEY`（类型：Secret 加密，必须32位）- 加密密钥
   - `BOT_TOKEN`（类型：Secret 加密）- Bot Token（用于自动获取文件，格式：`123456:ABC-DEF`，不含 `bot` 前缀）

**方式 2：使用 Wrangler CLI**

```bash
# 设置上传密码
echo "你的密码" | wrangler secret put ACCESS_PASSWORD

# 设置加密密钥（32位）
echo "你的32位密钥" | wrangler secret put ENCRYPTION_KEY

# 设置 Bot Token（用于自动获取文件）
echo "123456:ABC-DEF" | wrangler secret put BOT_TOKEN
```

**生成安全密钥：**

```bash
# 生成访问密码
openssl rand -base64 24

# 生成32位加密密钥
openssl rand -hex 16
```

### 8. 部署

```bash
wrangler deploy
```

部署成功后会得到一个 URL，例如：
```
https://tgapi.your-subdomain.workers.dev
```

### 9. 使用 GitHub Actions 自动部署（可选）

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main, d1]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          npm install -g wrangler
          wrangler deploy --keep-vars
          echo "${{ secrets.ACCESS_PASSWORD }}" | wrangler secret put ACCESS_PASSWORD
          echo "${{ secrets.ENCRYPTION_KEY }}" | wrangler secret put ENCRYPTION_KEY
```

在 GitHub 仓库设置 Secrets：
- `CLOUDFLARE_API_TOKEN`
- `ACCESS_PASSWORD`
- `ENCRYPTION_KEY`

## 📖 使用指南

### 上传文件（需要密码）

**注意：不需要提供 Bot Token，已自动使用环境变量中的 BOT_TOKEN**

#### 上传图片

```bash
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot/sendPhoto' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的频道ID>' \
  -F 'photo=@/path/to/image.jpg'
```

#### 上传文档

```bash
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot/sendDocument' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的频道ID>' \
  -F 'document=@/path/to/file.pdf'
```

#### 上传视频

```bash
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot/sendVideo' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的频道ID>' \
  -F 'video=@/path/to/video.mp4'
```

#### 超级群组指定话题

```bash
# 发送文档到指定话题
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot/sendDocument' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的群组ID>' \
  -F 'message_thread_id=话题ID' \
  -F 'document=@"shortcuts.json"'

# 发送消息到指定话题
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot/sendMessage' \
  -H 'Content-Type: application/json' \
  -H 'X-Access-Password: 你的密码' \
  -d '{
    "chat_id": <你的群组ID>,
    "message_thread_id": 话题ID,
    "text": "这是发送到指定话题的消息"
  }'

# 发送图片到指定话题
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot/sendPhoto' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的群组ID>' \
  -F 'message_thread_id=话题ID' \
  -F 'photo=@/path/to/image.jpg'
```

### 为转发的文件生成链接（需要密码）

如果你已经在 Telegram 频道转发了文件，可以使用此 API 生成下载链接：

```bash
curl -X POST 'https://tgapi.your-subdomain.workers.dev/add-forwarded-file' \
  -H 'Content-Type: application/json' \
  -H 'X-Access-Password: 你的密码' \
  -d '{
    "chat_id": "@频道用户名 或 -1001234567890",
    "message_id": 279
  }'
```

**注意：不需要提供 token，已自动使用环境变量中的 BOT_TOKEN**

**获取消息 ID 的方法：**
1. 在 Telegram 桌面版右键点击消息
2. 选择"复制消息链接"
3. 链接格式：`https://t.me/c/1234567890/279`
4. 最后的数字 `279` 就是消息 ID

**获取频道 ID 的方法：**
- 公开频道：直接使用 `@username` 格式
- 私有频道：将 Bot 添加为管理员，访问 `https://api.telegram.org/bot<TOKEN>/getUpdates` 查看

**批量处理脚本（Python）：**

```python
#!/usr/bin/env python3
import requests

WORKER_URL = "https://your-worker.workers.dev"
PASSWORD = "your-password"
CHAT_ID = "@mychannel"  # 或 -1001234567890

def add_forwarded_file(message_id):
    response = requests.post(
        f"{WORKER_URL}/add-forwarded-file",
        headers={
            "Content-Type": "application/json",
            "X-Access-Password": PASSWORD
        },
        json={
            "chat_id": CHAT_ID,
            "message_id": message_id
        }
    )
    result = response.json()
    if result.get("success"):
        print(f"✅ 消息 {message_id}: {result['cdn']['url']}")
    else:
        print(f"❌ 消息 {message_id}: {result.get('error')}")

# 批量处理多个消息
for msg_id in [279, 280, 281, 282]:
    add_forwarded_file(msg_id)
```

### 响应示例

```json
{
  "ok": true,
  "result": {
    "message_id": 279,
    "chat": {
      "id": -1001826585339,
      "username": "myblog",
      "title": "我的博客图床"
    },
    "photo": [...]
  },
  "cdn": {
    "url": "https://tgapi.your-subdomain.workers.dev/file/@myblog/279",
    "url_encrypted": "https://tgapi.your-subdomain.workers.dev/file/xYz9Kp2mN4...",
    "filename": "photo.jpg",
    "message_id": 279,
    "chat_id": -1001826585339,
    "channel_identifier": "@myblog",
    "size": 125678,
    "permanent": true,
    "telegram_link": "https://t.me/myblog/279",
    "markdown": "![photo.jpg](https://tgapi.your-subdomain.workers.dev/file/@myblog/279)",
    "html": "<img src=\"https://tgapi.your-subdomain.workers.dev/file/@myblog/279\" alt=\"photo.jpg\" />",
    "note": "链接永久有效，无需密码即可下载，可直接跳转到 Telegram 查看原消息"
  }
}
```

### 下载文件（无需密码）

#### 方式 1：直接访问（推荐，无需预先生成）⭐

只要满足以下条件，直接访问链接即可自动下载：
- ✅ Bot 是频道/群组的管理员
- ✅ 已设置 `BOT_TOKEN` 环境变量
- ✅ 知道消息 ID

**公开频道：**
```
https://tgapi.your-subdomain.workers.dev/file/@myblog/279
```

**私有频道：**
```
https://tgapi.your-subdomain.workers.dev/file/1826585339/279
```

**工作原理：**
1. 首次访问时，Worker 自动从 Telegram 获取文件信息
2. 加密存储到 D1 数据库
3. 之后访问直接从 D1 读取，速度更快

#### 方式 2：预先生成链接

如果想提前生成链接（批量处理），使用 `/add-forwarded-file` API：

```bash
curl -X POST 'https://tgapi.your-subdomain.workers.dev/add-forwarded-file' \
  -H 'Content-Type: application/json' \
  -H 'X-Access-Password: 你的密码' \
  -d '{
    "token": "123456:ABC-DEF",
    "chat_id": "@myblog",
    "message_id": 279
  }'
```

#### 方式 3：加密链接（隐藏消息ID）

```
https://tgapi.your-subdomain.workers.dev/file/xYz9Kp2mN4qR8sT6...
```

### 在博客中使用

#### Markdown

```markdown
![我的图片](https://tgapi.your-subdomain.workers.dev/file/@myblog/279)

![头像](https://tgapi.your-subdomain.workers.dev/file/1826585339/280)
```

#### HTML

```html
<img src="https://tgapi.your-subdomain.workers.dev/file/@myblog/279" alt="示例图片" />

<a href="https://tgapi.your-subdomain.workers.dev/file/1826585339/280">下载文档</a>

<video src="https://tgapi.your-subdomain.workers.dev/file/@myblog/281" controls></video>
```

## 🛠️ 上传脚本

创建 `upload.sh` 文件：

```bash
#!/bin/bash

# ===== 配置 =====
PASSWORD="你的密码"
CHAT_ID="你的频道ID"
PROXY_URL="https://tgapi.your-subdomain.workers.dev"

# ===== 脚本 =====
if [ $# -eq 0 ]; then
  echo "用法: $0 <文件路径>"
  echo "示例: $0 /path/to/image.jpg"
  exit 1
fi

FILE="$1"
if [ ! -f "$FILE" ]; then
  echo "错误：文件不存在"
  exit 1
fi

FILENAME=$(basename "$FILE")
EXT="${FILENAME##*.}"

# 判断文件类型
case "$EXT" in
  jpg|jpeg|png|gif|bmp|webp) METHOD="sendPhoto"; FIELD="photo" ;;
  mp4|avi|mov|mkv|webm) METHOD="sendVideo"; FIELD="video" ;;
  mp3|wav|ogg|flac|m4a) METHOD="sendAudio"; FIELD="audio" ;;
  *) METHOD="sendDocument"; FIELD="document" ;;
esac

echo "正在上传: $FILENAME ($METHOD)"

RESPONSE=$(curl -s -X POST "${PROXY_URL}/bot${BOT_TOKEN}/${METHOD}" \
  -H "X-Access-Password: ${PASSWORD}" \
  -F "chat_id=${CHAT_ID}" \
  -F "${FIELD}=@${FILE}")

if echo "$RESPONSE" | jq -e '.ok' > /dev/null 2>&1; then
  URL=$(echo "$RESPONSE" | jq -r '.cdn.url')
  TELEGRAM_LINK=$(echo "$RESPONSE" | jq -r '.cdn.telegram_link')
  MARKDOWN=$(echo "$RESPONSE" | jq -r '.cdn.markdown')
  
  echo "✓ 上传成功！"
  echo ""
  echo "=== 下载链接（无需密码）==="
  echo "$URL"
  echo ""
  echo "=== Telegram 原消息 ==="
  echo "$TELEGRAM_LINK"
  echo ""
  echo "=== Markdown 引用 ==="
  echo "$MARKDOWN"
  
  # 尝试复制到剪贴板
  if command -v pbcopy > /dev/null 2>&1; then
    echo "$URL" | pbcopy
    echo ""
    echo "✓ 链接已复制到剪贴板（macOS）"
  elif command -v xclip > /dev/null 2>&1; then
    echo "$URL" | xclip -selection clipboard
    echo ""
    echo "✓ 链接已复制到剪贴板（Linux）"
  elif command -v clip.exe > /dev/null 2>&1; then
    echo "$URL" | clip.exe
    echo ""
    echo "✓ 链接已复制到剪贴板（Windows/WSL）"
  fi
else
  echo "✗ 上传失败"
  echo "$RESPONSE" | jq '.'
  exit 1
fi
```

使用方法：

```bash
chmod +x upload.sh

# 上传图片
./upload.sh /path/to/image.jpg

# 上传文档
./upload.sh /path/to/document.pdf
```

## 🔧 高级配置

### 自定义域名

1. 在 Cloudflare Dashboard 中添加自定义域名
2. 更新 `wrangler.toml`：

```toml
routes = [
  { pattern = "img.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

### 本地开发

创建 `.dev.vars` 文件（不要提交到 Git）：

```text
ACCESS_PASSWORD=your-password
ENCRYPTION_KEY=your-32-character-key
```

运行本地开发服务器：

```bash
wrangler dev
```

### 环境变量管理

**重要提示：** 使用 GitHub Actions 部署时，为了避免环境变量被覆盖：

1. **在 Cloudflare Dashboard 设置变量**（Settings → Variables）
2. **在 GitHub Secrets 中添加相同的变量**
3. **在部署脚本中使用 `--keep-vars` 参数**

```yaml
# .github/workflows/deploy.yml
- run: wrangler deploy --keep-vars
```

或者使用 Secrets 注入：

```yaml
- run: |
    echo "${{ secrets.ACCESS_PASSWORD }}" | wrangler secret put ACCESS_PASSWORD
    echo "${{ secrets.ENCRYPTION_KEY }}" | wrangler secret put ENCRYPTION_KEY
```

## 📊 限制说明

### Cloudflare Workers 免费版

- 请求：100,000 次/天
- CPU 时间：10ms/请求
- 请求体大小：100MB

### Cloudflare D1 免费版

- 存储：5GB
- 每日读取：500 万行
- 每日写入：10 万行

相比 KV 存储（1GB + 有限写入），D1 提供了更大的免费额度！

### Telegram Bot API

- 文件大小：50MB（通过 Bot API）
- 文件大小：2GB（通过客户端上传）

## 🔒 安全说明

### 上传安全

- ✅ 密码使用 Cloudflare Secret 加密存储
- ✅ 密码通过 HTTPS 传输
- ✅ 只有知道密码的人才能上传

### 下载安全

- ✅ Bot Token 经过 AES-256-GCM 加密
- ✅ 下载链接不包含明文 Token
- ✅ 链接可以公开分享，不会泄露密码

### 建议

1. 使用强密码（至少 16 位，包含大小写字母、数字、符号）
2. 加密密钥必须是 32 位字符
3. 定期更换密码
4. 不要将上传密码泄露给他人
5. 使用自定义域名（更专业）
6. 使用 Secret 类型存储敏感变量（而非 Text）

## ❓ 常见问题

### Q: 如何获取频道 ID？

A: 
1. **公开频道**：直接使用 `@频道用户名` 格式
2. **私有频道方法 1**：转发频道消息到 [@userinfobot](https://t.me/userinfobot)
3. **私有频道方法 2**：
   - 将 Bot 添加为频道管理员
   - 访问 `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - 在返回的 JSON 中查找 `"chat":{"id":-1001234567890}`

### Q: 私有频道的 ID 格式是什么？

A: 
- **完整 ID**：`-1001826585339`（用于 API 调用）
- **链接中的 ID**：`1826585339`（去掉 `-100` 前缀）

### Q: 为什么环境变量设置后还是密码错误？

A: 
1. **检查设置位置**：必须在 **Settings → Variables** 而不是 Build settings
2. **检查环境**：确保 Production 和 Preview 都设置了
3. **检查分支**：d1 分支需要在 Preview 环境设置
4. **重新部署**：设置后点击 "Save and Deploy"
5. **使用 Secret 类型**：加密存储更安全

### Q: 上传失败怎么办？

A: 检查以下几点：
1. Bot Token 是否正确
2. Bot 是否已加入频道并有发送消息权限
3. 访问密码是否正确（区分大小写）
4. 文件大小是否超过 50MB
5. 查看 Worker 日志：`wrangler tail`

### Q: 下载链接为什么是 404？

A: 
1. 检查 D1 数据库是否正确绑定
2. 确认数据库表已创建（访问 `/init-db`）
3. 确认文件已成功上传
4. 等待几秒钟（数据库同步需要时间）
5. 检查链接格式是否正确

### Q: 如何删除已上传的文件？

A: 
1. 在 Telegram 频道中删除该消息
2. 下载链接会失效（因为 Telegram 文件被删除）
3. 如需清理 D1 数据：
   ```bash
   wrangler d1 execute telegram-files --command="DELETE FROM file_mappings WHERE file_key='@channel/123'"
   ```

### Q: D1 和 KV 有什么区别？

A:
- **D1**：关系型数据库，5GB 免费，支持 SQL 查询
- **KV**：键值存储，1GB 免费，写入次数有限

**推荐使用 D1**，免费额度更大，更适合长期使用。

### Q: 转发的文件可以下载吗？

A:
可以！使用 `/add-forwarded-file` API 为转发的文件生成下载链接。Bot 必须是频道管理员才能访问消息。

---

**⭐ 如果这个项目对你有帮助，请给一个 Star！**

## 📝 更新日志

### v2.0 (2025-12)
- ✨ 新增 D1 数据库支持（取代 KV）
- ✨ 新增转发文件链接生成功能
- 🔒 改进环境变量安全性（支持 Secret 加密）
- 📚 完善部署文档和故障排查指南

### v1.0 (2025-11)
- 🎉 首次发布
- ✨ 支持文件上传和下载
- ✨ 基于消息 ID 的友好链接
- 🔒 Token 加密保护