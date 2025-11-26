// Cloudflare Workers - Telegram 图床/文件代理服务
// 功能：密码验证 + 友好文件名链接 + 永久有效 + 文件上传

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // ===== 配置区域 =====
    // 在 Cloudflare Workers 设置中配置这些环境变量
    // 使用 wrangler secret put 命令设置
    const ACCESS_PASSWORD = env.ACCESS_PASSWORD || "请设置你的访问密码";
    const ENCRYPTION_KEY = env.ENCRYPTION_KEY || "请设置32位加密密钥abcd1234";
    
    // KV 命名空间（用于存储文件名映射）
    const FILE_STORE = env.FILE_STORE;
    
    // 处理 CORS 跨域请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Password',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // 根路径返回使用说明
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(JSON.stringify({
        service: 'Telegram 图床/文件代理服务',
        version: '3.0',
        description: '支持友好文件名的永久直链，适合博客图床',
        security: {
          password_required: true,
          encryption: 'AES-256-GCM 加密',
          token_protection: '所有 Token 都经过加密处理，不会泄露'
        },
        usage: {
          authentication: {
            header: 'X-Access-Password: 你的密码',
            parameter: '?password=你的密码'
          },
          upload: {
            path: '/bot<你的TOKEN>/<方法名>',
            example: 'POST /bot123456:ABC-DEF/sendDocument',
            methods: ['sendDocument', 'sendPhoto', 'sendVideo', 'sendAudio']
          },
          download: {
            friendly_link: '/file/文件名.扩展名',
            encrypted_link: '/file/<加密字符串>',
            example: '/file/shortx.json',
            note: '支持友好文件名链接，永久有效'
          }
        },
        features: [
          '密码验证保护',
          '友好的文件名链接（如 /file/shortx.json）',
          '加密备用链接',
          'Token 完全加密，不会泄露',
          '支持文件上传（最大 100MB）',
          '自动生成永久直链',
          '适合做图床和文件分享'
        ],
        limits: {
          cloudflare_limit: '100MB（免费版）',
          telegram_limit: '50MB（Telegram Bot API）',
          link_expires: '永久有效',
          kv_storage: FILE_STORE ? '已启用' : '未启用（需要配置 KV）'
        }
      }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // ===== 密码验证 =====
    const providedPassword = request.headers.get('X-Access-Password') || 
                            url.searchParams.get('password') ||
                            url.searchParams.get('pwd');
    
    if (providedPassword !== ACCESS_PASSWORD) {
      return new Response(JSON.stringify({
        error: '身份验证失败',
        message: '密码错误或未提供访问密码',
        hint: '请添加 X-Access-Password 请求头或 ?password=xxx 参数'
      }), {
        status: 401,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // ===== 处理文件下载 =====
    // 路径格式：/file/<文件名或加密数据>
    if (url.pathname.startsWith('/file/')) {
      const fileIdentifier = url.pathname.substring(6); // 去掉 '/file/'
      
      if (!fileIdentifier) {
        return new Response(JSON.stringify({
          error: '缺少文件标识',
          message: '请提供文件名或加密链接'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      let fileData = null;
      
      // 判断是友好文件名还是加密数据
      // 如果包含文件扩展名，则尝试从 KV 查找
      const hasExtension = /\.[a-zA-Z0-9]+$/.test(fileIdentifier);
      
      if (hasExtension && FILE_STORE) {
        // 尝试从 KV 存储获取加密数据
        try {
          const encryptedData = await FILE_STORE.get(fileIdentifier);
          if (encryptedData) {
            // 解密数据
            const decrypted = await decryptData(encryptedData, ENCRYPTION_KEY);
            fileData = JSON.parse(decrypted);
          }
        } catch (error) {
          console.error('从 KV 读取失败:', error);
        }
      }
      
      // 如果 KV 查找失败，尝试直接解密（可能是加密链接）
      if (!fileData) {
        try {
          const decrypted = await decryptData(fileIdentifier, ENCRYPTION_KEY);
          fileData = JSON.parse(decrypted);
        } catch (error) {
          return new Response(JSON.stringify({
            error: '文件不存在',
            message: '找不到该文件，可能已被删除或链接无效',
            identifier: fileIdentifier
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      }
      
      // 构造 Telegram 下载 URL
      const telegramFileUrl = `https://api.telegram.org/file/bot${fileData.token}/${fileData.path}`;
      
      try {
        // 转发下载请求
        const fileResponse = await fetch(telegramFileUrl);
        
        if (!fileResponse.ok) {
          return new Response(JSON.stringify({
            error: '文件下载失败',
            message: '无法从 Telegram 服务器获取文件',
            status: fileResponse.status
          }), {
            status: fileResponse.status,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
        
        const headers = new Headers(fileResponse.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cache-Control', 'public, max-age=31536000'); // 缓存一年
        
        // 添加文件名
        if (fileData.filename) {
          headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(fileData.filename)}"`);
        }
        
        return new Response(fileResponse.body, {
          status: fileResponse.status,
          headers: headers
        });
        
      } catch (error) {
        return new Response(JSON.stringify({
          error: '下载请求失败',
          detail: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }
    
    // ===== 处理 Bot API 请求 =====
    // 支持 /bot<token>/<method> 和 /bot/<token>/<method>
    const pathMatch = url.pathname.match(/^\/bot\/?([^\/]+)\/(.+)$/);
    
    if (!pathMatch) {
      return new Response(JSON.stringify({
        error: 'URL 格式错误',
        usage: '/bot<你的TOKEN>/<方法名> 或 /bot/<你的TOKEN>/<方法名>',
        examples: [
          '/bot123456:ABC-DEF/sendMessage',
          '/bot/123456:ABC-DEF/sendDocument',
          '/bot123456:ABC-DEF/sendPhoto'
        ],
        your_path: url.pathname
      }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const [, token, method] = pathMatch;
    const telegramUrl = `https://api.telegram.org/bot${token}/${method}`;

    try {
      // 复制请求头
      const headers = new Headers(request.headers);
      headers.delete('x-access-password'); // 移除密码头，避免泄露
      headers.delete('cf-connecting-ip');
      headers.delete('cf-ray');
      headers.delete('cf-visitor');
      headers.delete('cf-ipcountry');
      
      // 处理 GET 请求参数
      let finalUrl = telegramUrl;
      if (request.method === 'GET' && url.search) {
        const params = new URLSearchParams(url.search);
        params.delete('password'); // 移除密码参数
        params.delete('pwd');
        const cleanParams = params.toString();
        if (cleanParams) {
          finalUrl = `${telegramUrl}?${cleanParams}`;
        }
      }

      // 转发请求到 Telegram API
      const proxyRequest = new Request(finalUrl, {
        method: request.method,
        headers: headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' 
          ? request.body 
          : null,
        duplex: 'half'
      });

      console.log(`[${new Date().toISOString()}] ${request.method} ${method}`);

      // 获取响应
      const response = await fetch(proxyRequest);
      const responseText = await response.text();
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        // 如果不是 JSON，直接返回原始响应
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(responseText, {
          status: response.status,
          headers: responseHeaders
        });
      }

      // ===== 生成友好链接 =====
      const needsDirectLink = [
        'sendDocument', 'sendPhoto', 'sendVideo', 
        'sendAudio', 'sendAnimation', 'sendVoice',
        'sendVideoNote', 'sendSticker'
      ].some(m => method.toLowerCase().includes(m.toLowerCase()));

      if (responseData.ok && needsDirectLink && responseData.result) {
        let fileId = null;
        let filename = null;
        const result = responseData.result;
        
        // 提取 file_id 和文件名
        if (result.document) {
          fileId = result.document.file_id;
          filename = result.document.file_name || 'document';
        } else if (result.photo) {
          fileId = result.photo[result.photo.length - 1].file_id;
          filename = `photo_${Date.now()}.jpg`;
        } else if (result.video) {
          fileId = result.video.file_id;
          filename = result.video.file_name || `video_${Date.now()}.mp4`;
        } else if (result.audio) {
          fileId = result.audio.file_id;
          filename = result.audio.file_name || `audio_${Date.now()}.mp3`;
        } else if (result.animation) {
          fileId = result.animation.file_id;
          filename = result.animation.file_name || `animation_${Date.now()}.gif`;
        } else if (result.voice) {
          fileId = result.voice.file_id;
          filename = `voice_${Date.now()}.ogg`;
        } else if (result.video_note) {
          fileId = result.video_note.file_id;
          filename = `video_note_${Date.now()}.mp4`;
        } else if (result.sticker) {
          fileId = result.sticker.file_id;
          filename = `sticker_${Date.now()}.webp`;
        }

        if (fileId) {
          try {
            // 获取文件路径
            const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
            const fileResponse = await fetch(getFileUrl);
            const fileDataResponse = await fileResponse.json();

            if (fileDataResponse.ok && fileDataResponse.result.file_path) {
              // 准备文件信息（不包含过期时间）
              const fileInfo = {
                token: token,
                path: fileDataResponse.result.file_path,
                filename: filename
              };
              
              // 加密文件信息
              const encrypted = await encryptData(JSON.stringify(fileInfo), ENCRYPTION_KEY);
              
              // 生成友好文件名链接
              const friendlyUrl = `${url.origin}/file/${filename}`;
              const encryptedUrl = `${url.origin}/file/${encrypted}`;
              
              // 如果有 KV 存储，保存文件名映射
              if (FILE_STORE) {
                try {
                  await FILE_STORE.put(filename, encrypted, {
                    expirationTtl: 86400 * 365 * 10 // 10 年过期（实际上是永久）
                  });
                } catch (error) {
                  console.error('保存到 KV 失败:', error);
                }
              }
              
              // 构造响应
              responseData.cdn = {
                url: friendlyUrl,
                url_encrypted: encryptedUrl,
                filename: filename,
                size: fileDataResponse.result.file_size,
                permanent: true,
                markdown: `![${filename}](${friendlyUrl})`,
                html: `<img src="${friendlyUrl}" alt="${filename}" />`,
                note: FILE_STORE 
                  ? '友好链接和加密链接都永久有效，可用于博客图床'
                  : '仅加密链接可用（需要配置 KV 存储才能使用友好链接）'
              };
              
              // 添加原始 Telegram 信息（但不包含明文 token）
              responseData.telegram_info = {
                file_id: fileId,
                file_unique_id: fileDataResponse.result.file_unique_id,
                file_size: fileDataResponse.result.file_size
              };
            }
          } catch (error) {
            console.error('生成下载链接时出错:', error);
            // 即使出错也不影响原始响应
          }
        }
      }
      
      // 返回响应
      const responseHeaders = new Headers();
      responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      
      return new Response(JSON.stringify(responseData, null, 2), {
        status: response.status,
        headers: responseHeaders
      });

    } catch (error) {
      console.error('代理请求失败:', error);
      return new Response(JSON.stringify({
        error: '代理请求失败',
        detail: error.message,
        method: method,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};

// ===== 加密函数 =====
// 使用 AES-256-GCM 加密文件信息
async function encryptData(data, key) {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  // 生成 32 字节密钥
  const keyBuffer = encoder.encode(key.padEnd(32, '0').substring(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  // 生成随机 IV（初始化向量）
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // 加密数据
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    dataBuffer
  );
  
  // 将 IV 和加密数据组合在一起
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  // Base64 URL 安全编码
  return btoa(String.fromCharCode(...combined))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ===== 解密函数 =====
// 解密 AES-256-GCM 加密的数据
async function decryptData(encryptedData, key) {
  const encoder = new TextEncoder();
  
  // Base64 URL 解码
  const padding = '='.repeat((4 - encryptedData.length % 4) % 4);
  const base64 = encryptedData
    .replace(/-/g, '+')
    .replace(/_/g, '/') + padding;
  
  const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  
  // 分离 IV 和加密数据
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  
  // 生成 32 字节密钥
  const keyBuffer = encoder.encode(key.padEnd(32, '0').substring(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  // 解密数据
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    encrypted
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}