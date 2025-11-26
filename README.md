支持三种链接格式：
1. **ID链接**：`/file/279-shortx.json`
1. **短链接**：`/file/shortx.json`（文件名作为路径）
2. **加密链接**：`/file/xYz9Kp2mN4...`（完全加密，作为备用）

需要使用 Cloudflare Workers KV 来存储文件名到加密数据的映射。

## 配置 Cloudflare Workers KV

### 1. 创建 KV 命名空间

```bash
# 创建 KV 命名空间
wrangler kv:namespace create "FILE_STORE"

# 会输出类似：
# { binding = "FILE_STORE", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 2. 更新 `wrangler.toml`

```toml
name = "tgapi"
main = "src/index.js"
compatibility_date = "2024-11-25"

# KV 命名空间绑定
[[kv_namespaces]]
binding = "FILE_STORE"
id = "你的KV命名空间ID"  # 从上面的命令输出中获取

# 生产环境配置（可选）
# [[env.production.kv_namespaces]]
# binding = "FILE_STORE"
# id = "生产环境的KV_ID"
```

### 3. 设置密钥

```bash
# 设置访问密码
wrangler secret put ACCESS_PASSWORD
# 输入：mySecurePassword123

# 设置加密密钥
wrangler secret put ENCRYPTION_KEY
# 输入：abcdef1234567890abcdef1234567890
```
### 4. 设置密钥（仅用于上传）
wrangler secret put ACCESS_PASSWORD
wrangler secret put ENCRYPTION_KEY

### 5. 部署

```bash
wrangler deploy
```

## 使用示例


### ✅ 上传：需要密码
```bash
# 上传需要密码验证
curl -X POST 'https://tgbotapi.gongzhonghao.dpdns.org/bot<TOKEN>/sendDocument' \
  -H 'X-Access-Password: myPassword123' \
  -F 'chat_id=-1001826585339' \
  -F 'document=@shortx.json'
```

### ✅ 下载：无需密码
```bash
# 直接访问，无需密码
curl 'https://tgbotapi.gongzhonghao.dpdns.org/file/279-shortx.json'

# 浏览器直接打开
https://tgbotapi.gongzhonghao.dpdns.org/file/279-shortx.json
```

## 博客中使用（安全）

### Markdown 格式
```markdown
![配置文件](https://tgbotapi.gongzhonghao.dpdns.org/file/279-shortx.json)

![截图](https://tgbotapi.gongzhonghao.dpdns.org/file/280-screenshot.png)

![头像](https://tgbotapi.gongzhonghao.dpdns.org/file/281-avatar.jpg)
```

**✅ 密码不会泄露！**

### HTML 格式
```html
<img src="https://tgbotapi.gongzhonghao.dpdns.org/file/279-image.jpg" alt="示例图片" />

<a href="https://tgbotapi.gongzhonghao.dpdns.org/file/280-document.pdf">下载文档</a>

<video src="https://tgbotapi.gongzhonghao.dpdns.org/file/281-video.mp4" controls></video>
```

## 安全性说明

### 上传端保护
- ✅ 只有知道密码的人才能上传
- ✅ 防止恶意上传和滥用
- ✅ 密码存储在环境变量中

### 下载端开放
- ✅ 链接可以公开分享
- ✅ 适合博客、网站、论坛等
- ✅ Token 已加密，不会泄露
- ✅ 即使别人知道链接，也无法上传文件

## 响应示例

```json
{
  "ok": true,
  "result": {
    "message_id": 279,
    "document": {
      "file_name": "shortx.json",
      "file_size": 8590
    }
  },
  "cdn": {
    "url": "https://tgbotapi.gongzhonghao.dpdns.org/file/279-shortx.json",
    "url_by_name": "https://tgbotapi.gongzhonghao.dpdns.org/file/shortx.json",
    "url_encrypted": "https://tgbotapi.gongzhonghao.dpdns.org/file/xYz9Kp2mN4...",
    "filename": "shortx.json",
    "message_id": 279,
    "size": 8590,
    "permanent": true,
    "telegram_link": "https://t.me/c/1826585339/279",
    "markdown": "![shortx.json](https://tgbotapi.gongzhonghao.dpdns.org/file/279-shortx.json)",
    "html": "<img src=\"https://tgbotapi.gongzhonghao.dpdns.org/file/279-shortx.json\" alt=\"shortx.json\" />",
    "note": "链接永久有效，无需密码即可下载，基于消息ID，可直接跳转到 Telegram 查看原消息"
  }
}
```

**注意：Markdown 和 HTML 引用中都不需要密码参数！**

## 完整上传脚本

```bash
#!/bin/bash

PASSWORD="myPassword123"
BOT_TOKEN="7722553870:AAE5-y2t0DwIhzIlN-aIKEmiJ5vWQhWp3-o"
CHAT_ID="-1001826585339"
PROXY_URL="https://tgbotapi.gongzhonghao.dpdns.org"

if [ $# -eq 0 ]; then
  echo "用法: $0 <文件路径>"
  exit 1
fi

FILE="$1"
FILENAME=$(basename "$FILE")

echo "正在上传: $FILENAME"

# 判断文件类型
EXT="${FILENAME##*.}"
case "$EXT" in
  jpg|jpeg|png|gif|bmp|webp) METHOD="sendPhoto"; FIELD="photo" ;;
  mp4|avi|mov|mkv) METHOD="sendVideo"; FIELD="video" ;;
  mp3|wav|ogg|flac) METHOD="sendAudio"; FIELD="audio" ;;
  *) METHOD="sendDocument"; FIELD="document" ;;
esac

RESPONSE=$(curl -s -X POST "${PROXY_URL}/bot${BOT_TOKEN}/${METHOD}" \
  -H "X-Access-Password: ${PASSWORD}" \
  -F "chat_id=${CHAT_ID}" \
  -F "${FIELD}=@${FILE}")

if echo "$RESPONSE" | jq -e '.ok' > /dev/null; then
  URL=$(echo "$RESPONSE" | jq -r '.cdn.url')
  TELEGRAM_LINK=$(echo "$RESPONSE" | jq -r '.cdn.telegram_link')
  MARKDOWN=$(echo "$RESPONSE" | jq -r '.cdn.markdown')
  
  echo "✓ 上传成功！"
  echo ""
  echo "=== 下载链接（无需密码）==="
  echo "$URL"
  echo ""
  echo "=== Telegram 消息链接 ==="
  echo "$TELEGRAM_LINK"
  echo ""
  echo "=== Markdown 引用 ==="
  echo "$MARKDOWN"
  
  # 复制到剪贴板
  if command -v pbcopy > /dev/null 2>&1; then
    echo "$URL" | pbcopy
    echo ""
    echo "✓ 链接已复制到剪贴板"
  fi
else
  echo "✗ 上传失败"
  echo "$RESPONSE" | jq '.'
fi
```