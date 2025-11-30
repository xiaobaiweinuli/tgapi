# Telegram 代理服务

基于 Cloudflare Workers 的 Telegram Bot API 代理服务，支持文件上传和永久直链生成，适合做博客图床和文件分享。

## ✨ 主要特性

- 🔐 **上传密码保护** - 只有授权用户可以上传文件
- 🌍 **下载完全公开** - 生成的链接无需密码，可以直接分享
- 🔗 **友好的链接格式** - 基于频道和消息ID，简洁易读
  - 公开频道：`/file/@channelname/123`
  - 私有频道：`/file/1826585339/123`
- 🔒 **Token 加密保护** - 下载链接中不包含明文 Bot Token
- ♾️ **永久有效** - 链接永不过期
- 📱 **Telegram 原消息跳转** - 可以直接跳转到 Telegram 查看原文件
- 🚀 **CDN 加速** - 利用 Cloudflare 全球边缘节点
- 📦 **大文件支持** - 最大支持 100MB（Cloudflare 免费版）

## 🎯 使用场景

- ✅ 博客图床
- ✅ 文档分享
- ✅ 视频托管
- ✅ 音频文件
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

### 4. 创建 KV 命名空间

```bash
wrangler kv:namespace create "FILE_STORE"
```

记录输出的 KV ID，例如：
```
{ binding = "FILE_STORE", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 5. 配置 `wrangler.toml`

```toml
name = "tgapi"
main = "src/index.js"
compatibility_date = "2024-11-25"

# KV 命名空间绑定
[[kv_namespaces]]
binding = "FILE_STORE"
id = "你的KV命名空间ID"  # 替换为步骤4中获取的ID
```

### 6. 设置密钥

```bash
# 设置上传密码
wrangler secret put ACCESS_PASSWORD
# 输入你的密码，例如：mySecurePassword123

# 设置加密密钥（32位随机字符串）
wrangler secret put ENCRYPTION_KEY
# 输入32位密钥，例如：abcdef1234567890abcdef1234567890
```

### 7. 部署

```bash
wrangler deploy
```

部署成功后会得到一个 URL，例如：
```
https://tgapi.your-subdomain.workers.dev
```
## 改造成D1
```
将 Cloudflare Workers 脚本中的键值存储（KV）逻辑完全迁移到 D1 关系型数据库的逻辑。
下面是修改后的完整 Worker 脚本，以及您需要进行的 D1 数据库设置步骤。
🛠️ D1 迁移指南与修改后的 Worker 脚本
步骤一：D1 数据库设置
在部署此 Worker 之前，请确保您已完成以下操作：
 * 创建 D1 数据库： 在 Cloudflare 控制台或使用 wrangler CLI 创建一个新的 D1 数据库（例如命名为 telegram-map-db）。
 * 绑定数据库： 在您的 Worker 设置（或 wrangler.toml 文件）中，将这个 D1 数据库绑定到一个名为 FILE_DB 的环境变量上。
   wrangler.toml 示例:
   [[d1_databases]]
binding = "FILE_DB" # 脚本中使用的变量名
database_name = "telegram-map-db"
database_id = "YOUR_DATABASE_ID"

 * 创建数据表： 运行以下 SQL 命令来创建脚本所需的数据表 file_map。
   CREATE TABLE file_map (
  key_id TEXT PRIMARY KEY,           -- 存储友好链接 Key，如 @channelname/123
  encrypted_data TEXT NOT NULL,      -- 存储加密后的文件信息
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

步骤二：修改后的 Workers 脚本
请用以下代码替换您原有的 Worker 脚本内容。
主要的修改点：
 * 将配置变量 FILE_STORE 更改为 FILE_DB。
 * 在下载逻辑中，使用 FILE_DB.prepare().bind().all() 进行查询。
 * 在上传成功后，使用 FILE_DB.prepare().bind().run() 和 INSERT OR REPLACE 语句进行数据写入。
```

## 📖 使用指南

### 上传文件（需要密码）

#### 上传图片

```bash
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot<你的BOT_TOKEN>/sendPhoto' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的频道ID>' \
  -F 'photo=@/path/to/image.jpg'
```

#### 上传文档

```bash
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot<你的BOT_TOKEN>/sendDocument' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的频道ID>' \
  -F 'document=@/path/to/file.pdf'
```

#### 上传视频

```bash
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot<你的BOT_TOKEN>/sendVideo' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的频道ID>' \
  -F 'video=@/path/to/video.mp4'
```
## 超级群组指定话题
```
# 发送文档到指定话题
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot<你的BOT_TOKEN>/sendDocument' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的群组ID>' \
  -F 'message_thread_id=话题ID' \
  -F 'document=@"shortcuts.json"'

# 发送消息到指定话题
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot<你的BOT_TOKEN>/sendMessage' \
  -H 'Content-Type: application/json' \
  -d '{
    "chat_id": <你的群组ID>,
    "message_thread_id": 话题ID,
    "text": "这是发送到指定话题的消息"
  }'

# 发送图片到指定话题
curl -X POST 'https://tgapi.your-subdomain.workers.dev/bot<你的BOT_TOKEN>/sendPhoto' \
  -H 'X-Access-Password: 你的密码' \
  -F 'chat_id=<你的群组ID>' \
  -F 'message_thread_id=话题ID' \
   -F 'photo=@/path/to/image.jpg'
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

#### 公开频道

```
https://tgapi.your-subdomain.workers.dev/file/@myblog/279
```

#### 私有频道

```
https://tgapi.your-subdomain.workers.dev/file/1826585339/279
```

#### 加密链接（备用）

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
BOT_TOKEN="你的BOT_TOKEN"
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

### 环境变量

可以在 `wrangler.toml` 中设置公开的环境变量：

```toml
[vars]
# 这里可以放一些非敏感配置
```

**注意**：密码和加密密钥必须使用 `wrangler secret put` 设置，不要写在配置文件中。

## 📊 限制说明

### Cloudflare Workers 免费版

- 请求：100,000 次/天
- CPU 时间：10ms/请求
- 请求体大小：100MB

### Cloudflare KV 免费版

- 读取：100,000 次/天
- 写入：1,000 次/天
- 存储：1GB

### Telegram Bot API

- 文件大小：50MB（通过 Bot API）
- 文件大小：2GB（通过客户端上传）

## 🔒 安全说明

### 上传安全

- ✅ 密码存储在 Cloudflare Workers 环境变量中
- ✅ 密码通过 HTTPS 传输
- ✅ 只有知道密码的人才能上传

### 下载安全

- ✅ Bot Token 经过 AES-256-GCM 加密
- ✅ 下载链接不包含明文 Token
- ✅ 链接可以公开分享，不会泄露密码

### 建议

1. 使用强密码（至少 16 位，包含大小写字母、数字、符号）
2. 定期更换密码
3. 不要将上传密码泄露给他人
4. 使用自定义域名（更专业）

## ❓ 常见问题

### Q: 如何获取频道 ID？

A: 
1. 方法 1：转发频道消息到 [@userinfobot](https://t.me/userinfobot)
2. 方法 2：使用 Bot API 的 `getUpdates` 方法
3. 公开频道可以直接使用 `@频道用户名`

### Q: 私有频道的 ID 格式是什么？

A: 
- 完整 ID：`-1001826585339`（用于 API 调用）
- 链接中的 ID：`1826585339`（去掉 `-100` 前缀）

### Q: 上传失败怎么办？

A: 检查以下几点：
1. Bot Token 是否正确
2. Bot 是否已加入频道并有发送消息权限
3. 密码是否正确
4. 文件大小是否超过 50MB

### Q: 下载链接为什么是 404？

A: 
1. 检查 KV 是否正确配置
2. 确认文件已成功上传
3. 等待几秒钟（KV 同步需要时间）

### Q: 如何删除已上传的文件？

A: 
1. 在 Telegram 频道中删除该消息
2. 下载链接会失效（因为 Telegram 文件被删除）
3. 如需清理 KV 存储，可以在 Cloudflare Dashboard 中手动删除

---

**⭐ 如果这个项目对你有帮助，请给一个 Star！**
