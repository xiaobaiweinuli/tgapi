支持两种链接格式：

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

### 4. 部署

```bash
wrangler deploy
```

## 使用示例

### 上传文件

```bash
curl -X POST 'https://tgbotapi.gongzhonghao.dpdns.org/bot7722553870:AAE5-y2t0DwIhzIlN-aIKEmiJ5vWQhWp3-o/sendDocument' \
  -H 'X-Access-Password: mySecurePassword123' \
  -F 'chat_id=-1003129009664' \
  -F 'document=@/path/to/shortx.json'
```

### 响应示例

```json
{
  "ok": true,
  "result": {
    "message_id": 37,
    "document": {
      "file_name": "shortx.json",
      "file_id": "BQACAgUAAy...",
      "file_size": 8590
    }
  },
  "cdn": {
    "url": "https://tgbotapi.gongzhonghao.dpdns.org/file/shortx.json",
    "url_encrypted": "https://tgbotapi.gongzhonghao.dpdns.org/file/xYz9Kp2mN4qR8sT6...",
    "filename": "shortx.json",
    "size": 8590,
    "permanent": true,
    "markdown": "![shortx.json](https://tgbotapi.gongzhonghao.dpdns.org/file/shortx.json)",
    "html": "<img src=\"https://tgbotapi.gongzhonghao.dpdns.org/file/shortx.json\" alt=\"shortx.json\" />",
    "note": "友好链接和加密链接都永久有效，可用于博客图床"
  },
  "telegram_info": {
    "file_id": "BQACAgUAAy...",
    "file_unique_id": "AgADqh0A...",
    "file_size": 8590
  }
}
```

### 下载文件（两种方式）

```bash
# 方式 1：友好链接（需要密码）
curl -H 'X-Access-Password: mySecurePassword123' \
  'https://tgbotapi.gongzhonghao.dpdns.org/file/shortx.json'

# 方式 2：加密链接（需要密码）
curl -H 'X-Access-Password: mySecurePassword123' \
  'https://tgbotapi.gongzhonghao.dpdns.org/file/xYz9Kp2mN4qR8sT6...'

# 方式 3：URL 参数传密码
curl 'https://tgbotapi.gongzhonghao.dpdns.org/file/shortx.json?password=mySecurePassword123'
```

### 在博客中使用

```markdown
<!-- 友好链接 -->
![配置文件](https://tgbotapi.gongzhonghao.dpdns.org/file/shortx.json?password=xxx)

<!-- 或者加密链接 -->
![配置文件](https://tgbotapi.gongzhonghao.dpdns.org/file/xYz9Kp2mN4qR8sT6...?password=xxx)
```

## 文件名冲突处理

如果上传了同名文件，后上传的会覆盖前面的。如果想避免冲突，可以：

### 方法 1：自动添加时间戳

修改文件名生成逻辑（在代码中已实现）：
- 照片：`photo_1732012345678.jpg`
- 视频：`video_1732012345678.mp4`

### 方法 2：上传时重命名

```bash
# 上传前重命名文件
cp shortx.json shortx_v2.json

curl -X POST '...' \
  -F 'document=@shortx_v2.json'
```
