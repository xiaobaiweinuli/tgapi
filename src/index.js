// Cloudflare Workers - Telegram 图床/文件代理服务 (D1 版本)
// 功能：密码验证 + 消息ID友好链接 + 永久有效

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // ===== 配置区域 =====
    const ACCESS_PASSWORD = env.ACCESS_PASSWORD || "请设置你的访问密码";
    const ENCRYPTION_KEY = env.ENCRYPTION_KEY || "请设置32位加密密钥abcd1234";
    
    // D1 数据库绑定（用于存储消息ID映射）
    // 假设 D1 数据库已绑定到名为 FILE_DB 的环境变量
    const FILE_DB = env.FILE_DB; 
    
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
        version: '4.0 (D1)',
        description: '支持基于消息ID的友好链接,可直接跳转到 Telegram 查看',
        security: {
          upload_password_required: true,
          download_password_required: false,
          encryption: 'AES-256-GCM 加密',
          token_protection: '所有 Token 都经过加密处理,不会泄露'
        },
        usage: {
          authentication: {
            note: '仅上传需要密码验证,下载无需密码',
            upload_header: 'X-Access-Password: 你的密码',
            upload_parameter: '?password=你的密码',
            download: '无需密码,直接访问链接即可'
          },
          upload: {
            path: '/bot<你的TOKEN>/<方法名>',
            example: 'POST /bot123456:ABC-DEF/sendDocument',
            methods: ['sendDocument', 'sendPhoto', 'sendVideo', 'sendAudio']
          },
          download: {
            public_channel: '/file/@频道用户名/消息ID',
            private_channel: '/file/频道ID/消息ID',
            encrypted: '/file/<加密字符串>',
            example_public: '/file/@myblog/279',
            example_private: '/file/1826585339/279',
            note: '支持公开频道和私有频道,永久有效'
          }
        },
        features: [
          '上传需要密码验证,下载无需密码',
          '基于消息ID的友好链接',
          '可直接跳转到 Telegram 查看原消息',
          '加密文件下载链接（永久有效）',
          'Token 完全加密,不会泄露',
          '支持文件上传（最大 100MB）',
          '适合做公开图床和文件分享'
        ],
        limits: {
          cloudflare_limit: '100MB（免费版）',
          telegram_limit: '50MB（Telegram Bot API）',
          link_expires: '永久有效',
          d1_storage: FILE_DB ? '已启用 D1' : '未启用 D1（需要配置 D1）' // 更改为 D1 状态
        }
      }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // ===== 处理文件下载（不需要密码）=====
    // 路径格式：/file/@username/123 或 /file/1826585339/123 或 /file/<加密数据>
    if (url.pathname.startsWith('/file/')) {
      const pathParts = url.pathname.substring(6).split('/'); // 去掉 '/file/'
      
      if (pathParts.length === 0 || !pathParts[0]) {
        return new Response(JSON.stringify({
          error: '缺少文件标识',
          message: '请提供正确的文件路径',
          examples: [
            '/file/@channelname/123',
            '/file/1826585339/123',
            '/file/<encrypted>'
          ]
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      let fileData = null;
      let fileKey = null;
      
      // 判断路径格式
      if (pathParts.length === 2) {
        // 格式：@username/123 或 1826585339/123
        const chatIdentifier = pathParts[0];
        const messageId = pathParts[1];
        fileKey = `${chatIdentifier}/${messageId}`;
      } else if (pathParts.length === 1) {
        // 格式：加密字符串
        fileKey = pathParts[0];
      } else {
        return new Response(JSON.stringify({
          error: '路径格式错误',
          message: '不支持的路径格式',
          examples: [
            '/file/@channelname/123',
            '/file/1826585339/123'
          ]
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      // 尝试从 D1 获取 (替换了 KV 逻辑)
      if (FILE_DB && fileKey && pathParts.length !== 1) { // 只有友好链接才查 D1
        try {
          // 在 D1 数据库中查找 key_id
          const { results } = await FILE_DB.prepare(
            "SELECT encrypted_data FROM file_map WHERE key_id = ?"
          ).bind(fileKey).all();
          
          if (results && results.length > 0) {
            const encryptedData = results[0].encrypted_data;
            const decrypted = await decryptData(encryptedData, ENCRYPTION_KEY);
            fileData = JSON.parse(decrypted);
          }
        } catch (error) {
          console.error('从 D1 读取失败:', error);
        }
      }
      
      // 如果 D1 查找失败 或者 路径是加密链接,尝试直接解密
      if (!fileData && pathParts.length === 1) {
        try {
          const decrypted = await decryptData(fileKey, ENCRYPTION_KEY);
          fileData = JSON.parse(decrypted);
        } catch (error) {
          return new Response(JSON.stringify({
            error: '文件不存在',
            message: '找不到该文件,可能已被删除或链接无效',
            path: url.pathname
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      }
      
      if (!fileData) {
        return new Response(JSON.stringify({
          error: '文件不存在',
          message: '找不到该文件',
          path: url.pathname
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
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
    
    // ===== 密码验证（仅用于上传和 Bot API）=====
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
    
    // ===== 处理 Bot API 请求 =====
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
      const headers = new Headers(request.headers);
      headers.delete('x-access-password');
      headers.delete('cf-connecting-ip');
      headers.delete('cf-ray');
      headers.delete('cf-visitor');
      headers.delete('cf-ipcountry');
      
      let finalUrl = telegramUrl;
      if (request.method === 'GET' && url.search) {
        const params = new URLSearchParams(url.search);
        params.delete('password');
        params.delete('pwd');
        const cleanParams = params.toString();
        if (cleanParams) {
          finalUrl = `${telegramUrl}?${cleanParams}`;
        }
      }

      const proxyRequest = new Request(finalUrl, {
        method: request.method,
        headers: headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' 
          ? request.body 
          : null,
        duplex: 'half'
      });

      console.log(`[${new Date().toISOString()}] ${request.method} ${method}`);

      const response = await fetch(proxyRequest);
      const responseText = await response.text();
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(responseText, {
          status: response.status,
          headers: responseHeaders
        });
      }

      // ===== 生成基于消息ID的友好链接 =====
      const needsDirectLink = [
        'sendDocument', 'sendPhoto', 'sendVideo', 
        'sendAudio', 'sendAnimation', 'sendVoice',
        'sendVideoNote', 'sendSticker'
      ].some(m => method.toLowerCase().includes(m.toLowerCase()));

      if (responseData.ok && needsDirectLink && responseData.result) {
        let fileId = null;
        let filename = null;
        const result = responseData.result;
        const messageId = result.message_id; // 获取消息ID
        const chatId = result.chat?.id || result.sender_chat?.id;
        
        // 提取 file_id 和文件名
        if (result.document) {
          fileId = result.document.file_id;
          filename = result.document.file_name || 'document';
        } else if (result.photo) {
          fileId = result.photo[result.photo.length - 1].file_id;
          filename = 'photo.jpg';
        } else if (result.video) {
          fileId = result.video.file_id;
          filename = result.video.file_name || 'video.mp4';
        } else if (result.audio) {
          fileId = result.audio.file_id;
          filename = result.audio.file_name || 'audio.mp3';
        } else if (result.animation) {
          fileId = result.animation.file_id;
          filename = result.animation.file_name || 'animation.gif';
        } else if (result.voice) {
          fileId = result.voice.file_id;
          filename = 'voice.ogg';
        } else if (result.video_note) {
          fileId = result.video_note.file_id;
          filename = 'video_note.mp4';
        } else if (result.sticker) {
          fileId = result.sticker.file_id;
          filename = 'sticker.webp';
        }

        if (fileId && messageId) {
          try {
            // 获取文件路径
            const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
            const fileResponse = await fetch(getFileUrl);
            const fileDataResponse = await fileResponse.json();

            if (fileDataResponse.ok && fileDataResponse.result.file_path) {
              // 准备文件信息
              const fileInfo = {
                token: token,
                path: fileDataResponse.result.file_path,
                filename: filename,
                message_id: messageId,
                chat_id: chatId
              };
              
              // 加密文件信息
              const encrypted = await encryptData(JSON.stringify(fileInfo), ENCRYPTION_KEY);
              
              // 判断是公开频道还是私有频道/群组
              let channelIdentifier = null;
              let telegramMessageLink = null;
              let friendlyUrl = null;
              
              // 检查是否有 username（公开频道）
              const channelUsername = result.chat?.username || result.sender_chat?.username;
              
              if (channelUsername) {
                // 公开频道：使用 @username
                channelIdentifier = `@${channelUsername}`;
                telegramMessageLink = `https://t.me/${channelUsername}/${messageId}`;
                friendlyUrl = `${url.origin}/file/@${channelUsername}/${messageId}`;
              } else if (chatId) {
                // 私有频道/群组：使用数字ID（去掉 -100 前缀）
                const cleanChatId = chatId.toString().replace(/^-100/, '');
                channelIdentifier = cleanChatId;
                telegramMessageLink = `https://t.me/c/${cleanChatId}/${messageId}`;
                friendlyUrl = `${url.origin}/file/${cleanChatId}/${messageId}`;
              }
              
              const encryptedUrl = `${url.origin}/file/${encrypted}`;
              
              // 如果有 D1 存储,保存映射 (替换了 KV 逻辑)
              if (FILE_DB && channelIdentifier) {
                try {
                  const fileKey = `${channelIdentifier}/${messageId}`;
                  // 使用 D1 的 INSERT OR REPLACE 写入数据
                  await FILE_DB.prepare(
                    `INSERT OR REPLACE INTO file_map (key_id, encrypted_data) 
                     VALUES (?, ?)`
                  ).bind(fileKey, encrypted).run();
                } catch (error) {
                  console.error('保存到 D1 失败:', error);
                }
              }
              
              // 构造响应
              responseData.cdn = {
                url: friendlyUrl || encryptedUrl,
                url_encrypted: encryptedUrl,
                filename: filename,
                message_id: messageId,
                chat_id: chatId,
                channel_identifier: channelIdentifier,
                size: fileDataResponse.result.file_size,
                permanent: true,
                telegram_link: telegramMessageLink,
                markdown: `![${filename}](${friendlyUrl || encryptedUrl})`,
                html: `<img src="${friendlyUrl || encryptedUrl}" alt="${filename}" />`,
                note: FILE_DB && friendlyUrl // 更改提示信息中的变量
                  ? '链接永久有效,无需密码即可下载,可直接跳转到 Telegram 查看原消息'
                  : '加密链接永久有效（需要配置 D1 存储才能使用友好链接）'
              };
              
              // 添加原始 Telegram 信息
              responseData.telegram_info = {
                file_id: fileId,
                file_unique_id: fileDataResponse.result.file_unique_id,
                file_size: fileDataResponse.result.file_size,
                message_id: messageId,
                chat_id: chatId,
                channel_username: channelUsername || null
              };
            }
          } catch (error) {
            console.error('生成下载链接时出错:', error);
          }
        }
      }
      
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
async function encryptData(data, key) {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  const keyBuffer = encoder.encode(key.padEnd(32, '0').substring(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    dataBuffer
  );
  
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined))
    .替换(/\+/g, '-')
    .替换(/\//g, '_')
    .替换(/=/g, '');
}

// ===== 解密函数 =====
async function decryptData(encryptedData, key) {
  const encoder = new TextEncoder();
  
  const padding = '='.repeat((4 - encryptedData.length % 4) % 4);
  const base64 = encryptedData
    .替换(/-/g, '+')
    .替换(/_/g, '/') + padding;
  
  const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  
  const keyBuffer = encoder.encode(key.padEnd(32, '0').substring(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    encrypted
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
