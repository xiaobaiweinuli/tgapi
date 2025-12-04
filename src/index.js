// Cloudflare Workers - Telegram 图床/文件代理服务 (D1 版本)
// 功能：密码验证 + 消息ID友好链接 + 永久有效

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // ===== 配置区域 =====
    const ACCESS_PASSWORD = env.ACCESS_PASSWORD || "";
    const ENCRYPTION_KEY = env.ENCRYPTION_KEY || "";
    
    // 调试：检查环境变量是否正确加载（部署后可以删除）
    console.log('环境变量检查:', {
      hasPassword: !!ACCESS_PASSWORD,
      hasKey: !!ENCRYPTION_KEY,
      passwordLength: ACCESS_PASSWORD?.length || 0,
      keyLength: ENCRYPTION_KEY?.length || 0
    });
    
    // D1 数据库（用于存储消息ID映射）
    const FILE_DB = env.FILE_DB;
    
    // 初始化数据库表
    if (FILE_DB && url.pathname === '/init-db') {
      try {
        await FILE_DB.prepare(`
          CREATE TABLE IF NOT EXISTS file_mappings (
            file_key TEXT PRIMARY KEY,
            encrypted_data TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )
        `).run();
        
        await FILE_DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_created_at ON file_mappings(created_at)
        `).run();
        
        return new Response(JSON.stringify({
          success: true,
          message: '数据库表初始化成功',
          table: 'file_mappings',
          columns: ['file_key', 'encrypted_data', 'created_at']
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: '数据库初始化失败',
          detail: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }
    
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

    // ===== 处理 Telegram Webhook（Bot 监听消息）=====
    if (url.pathname.startsWith('/webhook/') && request.method === 'POST') {
      const webhookToken = url.pathname.substring(9); // 去掉 '/webhook/'
      
      // 验证 webhook token
      if (!env.BOT_TOKEN || webhookToken !== env.BOT_TOKEN.split(':')[1]) {
        return new Response(JSON.stringify({
          error: '无效的 webhook token'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      try {
        const update = await request.json();
        console.log('收到 Telegram 更新:', JSON.stringify(update));
        
        // 提取消息（可能是 message 或 channel_post）
        const msg = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
        
        if (!msg) {
          return new Response('OK', { status: 200 });
        }
        
        // 检查是否包含文件
        let fileId = null;
        let filename = null;
        let fileSize = null;
        
        if (msg.document) {
          fileId = msg.document.file_id;
          filename = msg.document.file_name || 'document';
          fileSize = msg.document.file_size;
        } else if (msg.photo) {
          const largestPhoto = msg.photo[msg.photo.length - 1];
          fileId = largestPhoto.file_id;
          filename = `photo_${msg.message_id}.jpg`;
          fileSize = largestPhoto.file_size;
        } else if (msg.video) {
          fileId = msg.video.file_id;
          filename = msg.video.file_name || `video_${msg.message_id}.mp4`;
          fileSize = msg.video.file_size;
        } else if (msg.audio) {
          fileId = msg.audio.file_id;
          filename = msg.audio.file_name || `audio_${msg.message_id}.mp3`;
          fileSize = msg.audio.file_size;
        } else if (msg.animation) {
          fileId = msg.animation.file_id;
          filename = msg.animation.file_name || `animation_${msg.message_id}.gif`;
          fileSize = msg.animation.file_size;
        } else if (msg.voice) {
          fileId = msg.voice.file_id;
          filename = `voice_${msg.message_id}.ogg`;
          fileSize = msg.voice.file_size;
        } else if (msg.video_note) {
          fileId = msg.video_note.file_id;
          filename = `video_note_${msg.message_id}.mp4`;
          fileSize = msg.video_note.file_size;
        } else if (msg.sticker) {
          fileId = msg.sticker.file_id;
          filename = `sticker_${msg.message_id}.webp`;
          fileSize = msg.sticker.file_size;
        }
        
        // 如果有文件，保存到 D1
        if (fileId && FILE_DB && env.BOT_TOKEN) {
          const chatId = msg.chat.id;
          const messageId = msg.message_id;
          const messageThreadId = msg.message_thread_id || null;
          
          // 获取文件路径
          const getFileUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`;
          const fileResponse = await fetch(getFileUrl);
          const fileResult = await fileResponse.json();
          
          if (fileResult.ok && fileResult.result.file_path) {
            const fileInfo = {
              token: env.BOT_TOKEN,
              path: fileResult.result.file_path,
              filename: filename,
              message_id: messageId,
              message_thread_id: messageThreadId,
              chat_id: chatId
            };
            
            // 加密存储
            const encrypted = await encryptData(JSON.stringify(fileInfo), ENCRYPTION_KEY);
            
            // 生成 file_key
            let channelIdentifier = null;
            if (msg.chat.username) {
              channelIdentifier = `@${msg.chat.username}`;
            } else {
              const cleanChatId = chatId.toString().replace(/^-100/, '');
              channelIdentifier = cleanChatId;
            }
            
            const fileKey = `${channelIdentifier}/${messageId}`;
            const timestamp = Math.floor(Date.now() / 1000);
            
            // 保存到 D1
            await FILE_DB.prepare(
              'INSERT OR REPLACE INTO file_mappings (file_key, encrypted_data, created_at) VALUES (?, ?, ?)'
            ).bind(fileKey, encrypted, timestamp).run();
            
            console.log(`✅ 已自动保存文件: ${fileKey} (${filename})`);
          }
        }
        
        return new Response('OK', { status: 200 });
        
      } catch (error) {
        console.error('处理 webhook 失败:', error);
        return new Response('OK', { status: 200 }); // 始终返回 200 避免 Telegram 重试
      }
    }
    
    // ===== 设置 Webhook（管理接口，需要密码）=====
    if (url.pathname === '/set-webhook' && request.method === 'POST') {
      const providedPassword = request.headers.get('X-Access-Password') || 
                              url.searchParams.get('password');
      
      if (providedPassword !== ACCESS_PASSWORD) {
        return new Response(JSON.stringify({
          error: '需要访问密码'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      if (!env.BOT_TOKEN) {
        return new Response(JSON.stringify({
          error: '未设置 BOT_TOKEN 环境变量'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      // 构造 webhook URL
      const webhookPath = env.BOT_TOKEN.split(':')[1];
      const webhookUrl = `${url.origin}/webhook/${webhookPath}`;
      
      // 调用 Telegram API 设置 webhook
      const setWebhookUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`;
      const webhookResponse = await fetch(setWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'channel_post', 'edited_message', 'edited_channel_post']
        })
      });
      
      const result = await webhookResponse.json();
      
      if (result.ok) {
        return new Response(JSON.stringify({
          success: true,
          message: 'Webhook 设置成功！Bot 现在会自动保存所有文件消息',
          webhook_url: webhookUrl,
          info: 'Bot 会自动监听所有群组/频道的文件消息并保存到数据库'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } else {
        return new Response(JSON.stringify({
          error: 'Webhook 设置失败',
          detail: result.description
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }
    
    // ===== 根路径返回使用说明 =====
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(JSON.stringify({
        service: 'Telegram 图床/文件代理服务',
        version: '6.0 (D1 + Webhook)',
        description: '支持基于消息ID的友好链接，Bot 自动监听并保存所有文件消息',
        security: {
          upload_password_required: true,
          download_password_required: false,
          encryption: 'AES-256-GCM 加密',
          token_protection: '所有 Token 都经过加密处理，不会泄露'
        },
        storage: {
          type: 'Cloudflare D1 Database',
          status: FILE_DB ? '已启用' : '未启用（需要绑定 FILE_DB）',
          init_url: '/init-db (首次使用需要访问此路径初始化数据库)'
        },
        webhook: {
          status: env.BOT_TOKEN ? '可用' : '未配置（需要设置 BOT_TOKEN）',
          setup_url: '/set-webhook (需要密码)',
          description: 'Bot 会自动监听并保存所有群组/频道的文件消息'
        },
        usage: {
          authentication: {
            note: '仅上传需要密码验证，下载无需密码',
            upload_header: 'X-Access-Password: 你的密码',
            upload_parameter: '?password=你的密码',
            download: '无需密码，直接访问链接即可'
          },
          upload: {
            path: '/bot<你的TOKEN>/<方法名>',
            example: 'POST /bot123456:ABC-DEF/sendDocument',
            methods: ['sendDocument', 'sendPhoto', 'sendVideo', 'sendAudio']
          },
          add_forwarded_file: {
            path: '/add-forwarded-file',
            method: 'POST',
            description: '为转发的消息生成下载链接（需要密码）',
            headers: {
              'Content-Type': 'application/json',
              'X-Access-Password': '你的密码'
            },
            body: {
              token: 'Bot Token',
              chat_id: '@channelname 或 -1001234567890',
              message_id: 123
            },
            example: 'curl -X POST https://your-worker.workers.dev/add-forwarded-file -H "Content-Type: application/json" -H "X-Access-Password: your-password" -d \'{"token":"123456:ABC","chat_id":"@mychannel","message_id":279}\''
          },
          download: {
            public_channel: '/file/@频道用户名/消息ID',
            private_channel: '/file/频道ID/消息ID',
            encrypted: '/file/<加密字符串>',
            example_public: '/file/@myblog/279',
            example_private: '/file/1826585339/279',
            note: '支持公开频道和私有频道，永久有效'
          }
        },
        features: [
          '上传需要密码验证，下载无需密码',
          '🆕 Bot 自动监听所有文件消息并保存',
          '🆕 知道消息ID即可直接下载，无需转发',
          '基于消息ID的友好链接',
          '可直接跳转到 Telegram 查看原消息',
          '加密文件下载链接（永久有效）',
          'Token 完全加密，不会泄露',
          '支持文件上传（最大 100MB）',
          '支持为转发的文件生成下载链接',
          '适合做公开图床和文件分享',
          '使用 D1 数据库存储（免费 5GB）'
        ],
        limits: {
          cloudflare_limit: '100MB（免费版）',
          telegram_limit: '50MB（Telegram Bot API）',
          link_expires: '永久有效',
          d1_storage: FILE_DB ? '已启用 (5GB 免费额度)' : '未启用（需要配置 D1）'
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
      let chatId = null;
      let messageId = null;
      
      // 判断路径格式
      if (pathParts.length === 2) {
        // 格式：@username/123 或 1826585339/123
        const chatIdentifier = pathParts[0];
        messageId = parseInt(pathParts[1]);
        fileKey = `${chatIdentifier}/${messageId}`;
        
        // 解析 chat_id
        if (chatIdentifier.startsWith('@')) {
          chatId = chatIdentifier;
        } else {
          chatId = `-100${chatIdentifier}`;
        }
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
      
      // 尝试从 D1 获取
      if (FILE_DB) {
        try {
          const result = await FILE_DB.prepare(
            'SELECT encrypted_data FROM file_mappings WHERE file_key = ?'
          ).bind(fileKey).first();
          
          if (result && result.encrypted_data) {
            const decrypted = await decryptData(result.encrypted_data, ENCRYPTION_KEY);
            fileData = JSON.parse(decrypted);
          }
        } catch (error) {
          console.error('从 D1 读取失败:', error);
        }
      }
      
      // 如果 D1 中找不到，提示用户设置 Webhook
      if (!fileData && chatId && messageId) {
        return new Response(JSON.stringify({
          error: '文件信息未找到',
          message: '该消息的文件信息尚未保存到数据库',
          solutions: [
            '1. 设置 Webhook 让 Bot 自动监听：POST /set-webhook',
            '2. 手动生成链接：POST /add-forwarded-file',
            '3. 通过 Bot API 重新上传文件'
          ],
          webhook_setup: {
            url: `${url.origin}/set-webhook`,
            method: 'POST',
            headers: {
              'X-Access-Password': '你的密码'
            }
          }
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      // 如果 D1 查找失败，尝试直接解密（可能是加密链接）
      if (!fileData && pathParts.length === 1) {
        try {
          const decrypted = await decryptData(fileKey, ENCRYPTION_KEY);
          fileData = JSON.parse(decrypted);
        } catch (error) {
          return new Response(JSON.stringify({
            error: '文件不存在',
            message: '找不到该文件，可能已被删除或链接无效',
            path: url.pathname,
            hint: chatId && messageId ? '请确保 Bot 是该频道/群组的管理员，并且在环境变量中设置了 BOT_TOKEN' : null
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
          path: url.pathname,
          hint: chatId && messageId ? '请确保：1) Bot 是管理员 2) 消息ID正确 3) 已设置 BOT_TOKEN 环境变量' : null
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
    
    // ===== 处理转发文件的链接生成（需要密码）=====
    if (url.pathname === '/add-forwarded-file' && request.method === 'POST') {
      const providedPassword = request.headers.get('X-Access-Password') || 
                              url.searchParams.get('password');
      
      if (providedPassword !== ACCESS_PASSWORD) {
        return new Response(JSON.stringify({
          error: '身份验证失败',
          message: '需要提供访问密码'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      if (!env.BOT_TOKEN) {
        return new Response(JSON.stringify({
          error: '未配置 BOT_TOKEN',
          message: '请在 Cloudflare 环境变量中设置 BOT_TOKEN'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      
      try {
        const body = await request.json();
        const { chat_id, message_id, message_thread_id } = body;
        
        if (!chat_id || !message_id) {
          return new Response(JSON.stringify({
            error: '参数缺失',
            required: ['chat_id', 'message_id'],
            optional: ['message_thread_id'],
            example: {
              chat_id: '@channelname 或 -1001234567890',
              message_id: 123,
              message_thread_id: 2214
            },
            note: '不需要提供 token，已使用环境变量中的 BOT_TOKEN'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
        
        const token = env.BOT_TOKEN;
        
        let fileId = null;
        let filename = null;
        let fileSize = null;
        
        // 方法1: 尝试使用 forwardMessage 到同一个群组（会返回消息详情）
        const forwardUrl = `https://api.telegram.org/bot${token}/forwardMessage`;
        const forwardPayload = {
          chat_id: chat_id,
          from_chat_id: chat_id,
          message_id: message_id
        };
        
        // 如果有话题ID，添加到转发请求中
        if (message_thread_id) {
          forwardPayload.message_thread_id = message_thread_id;
        }
        
        const forwardResponse = await fetch(forwardUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(forwardPayload)
        });
        
        const forwardData = await forwardResponse.json();
        
        if (forwardData.ok && forwardData.result) {
          const forwardedMsg = forwardData.result;
          
          // 提取文件信息
          if (forwardedMsg.document) {
            fileId = forwardedMsg.document.file_id;
            filename = forwardedMsg.document.file_name || 'document';
            fileSize = forwardedMsg.document.file_size;
          } else if (forwardedMsg.photo) {
            const largestPhoto = forwardedMsg.photo[forwardedMsg.photo.length - 1];
            fileId = largestPhoto.file_id;
            filename = 'photo.jpg';
            fileSize = largestPhoto.file_size;
          } else if (forwardedMsg.video) {
            fileId = forwardedMsg.video.file_id;
            filename = forwardedMsg.video.file_name || 'video.mp4';
            fileSize = forwardedMsg.video.file_size;
          } else if (forwardedMsg.audio) {
            fileId = forwardedMsg.audio.file_id;
            filename = forwardedMsg.audio.file_name || 'audio.mp3';
            fileSize = forwardedMsg.audio.file_size;
          } else if (forwardedMsg.animation) {
            fileId = forwardedMsg.animation.file_id;
            filename = forwardedMsg.animation.file_name || 'animation.gif';
            fileSize = forwardedMsg.animation.file_size;
          } else if (forwardedMsg.voice) {
            fileId = forwardedMsg.voice.file_id;
            filename = 'voice.ogg';
            fileSize = forwardedMsg.voice.file_size;
          } else if (forwardedMsg.video_note) {
            fileId = forwardedMsg.video_note.file_id;
            filename = 'video_note.mp4';
            fileSize = forwardedMsg.video_note.file_size;
          } else if (forwardedMsg.sticker) {
            fileId = forwardedMsg.sticker.file_id;
            filename = 'sticker.webp';
            fileSize = forwardedMsg.sticker.file_size;
          }
          
          // 删除刚才转发的消息（清理垃圾）
          try {
            await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chat_id,
                message_id: forwardedMsg.message_id
              })
            });
          } catch (e) {
            console.log('删除转发消息失败（不影响功能）:', e);
          }
        }
        
        // 方法2: 如果转发失败，尝试通过 copyMessage（某些情况更可靠）
        if (!fileId) {
          const copyUrl = `https://api.telegram.org/bot${token}/copyMessage`;
          const copyPayload = {
            chat_id: chat_id,
            from_chat_id: chat_id,
            message_id: message_id
          };
          
          if (message_thread_id) {
            copyPayload.message_thread_id = message_thread_id;
          }
          
          const copyResponse = await fetch(copyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(copyPayload)
          });
          
          const copyData = await copyResponse.json();
          
          if (!copyData.ok) {
            return new Response(JSON.stringify({
              error: '获取消息失败',
              detail: copyData.description || forwardData.description || '无法访问该消息',
              possible_reasons: [
                'Bot 不是群组管理员',
                '消息ID不存在',
                'Bot 没有读取消息的权限',
                '话题ID (message_thread_id) 不正确'
              ],
              debug_info: {
                forward_error: forwardData.description,
                copy_error: copyData.description
              }
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
          }
          
          // copyMessage 成功，删除复制的消息并返回错误（因为我们没拿到文件信息）
          if (copyData.result && copyData.result.message_id) {
            try {
              await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chat_id,
                  message_id: copyData.result.message_id
                })
              });
            } catch (e) {
              console.log('删除复制消息失败:', e);
            }
          }
          
          return new Response(JSON.stringify({
            error: '消息中没有文件',
            message: '该消息不包含可下载的文件，或文件类型不支持',
            supported_types: ['document', 'photo', 'video', 'audio', 'animation', 'voice', 'video_note', 'sticker']
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
        
        if (!fileId) {
          return new Response(JSON.stringify({
            error: '消息中没有文件',
            message: '该消息不包含可下载的文件'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
        
        // 获取文件路径
        const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
        const fileResponse = await fetch(getFileUrl);
        const fileDataResponse = await fileResponse.json();
        
        if (!fileDataResponse.ok || !fileDataResponse.result.file_path) {
          return new Response(JSON.stringify({
            error: '获取文件路径失败',
            detail: fileDataResponse.description,
            file_id: fileId
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
        
        // 使用获取到的文件大小，如果之前没有的话
        if (!fileSize && fileDataResponse.result.file_size) {
          fileSize = fileDataResponse.result.file_size;
        }
        
        // 准备文件信息
        const fileInfo = {
          token: token,
          path: fileDataResponse.result.file_path,
          filename: filename,
          message_id: message_id,
          message_thread_id: message_thread_id || null,
          chat_id: chat_id
        };
        
        // 加密
        const encrypted = await encryptData(JSON.stringify(fileInfo), ENCRYPTION_KEY);
        
        // 生成链接
        let channelIdentifier = null;
        let telegramMessageLink = null;
        let friendlyUrl = null;
        
        // 判断是公开频道还是私有频道/群组
        if (typeof chat_id === 'string' && chat_id.startsWith('@')) {
          // 公开频道
          const username = chat_id.substring(1);
          channelIdentifier = chat_id;
          
          // 如果有话题ID，构造话题链接
          if (message_thread_id) {
            telegramMessageLink = `https://t.me/${username}/${message_id}/${message_thread_id}`;
          } else {
            telegramMessageLink = `https://t.me/${username}/${message_id}`;
          }
          
          friendlyUrl = `${url.origin}/file/${chat_id}/${message_id}`;
        } else {
          // 私有频道/群组（数字ID）
          const cleanChatId = chat_id.toString().replace(/^-100/, '');
          channelIdentifier = cleanChatId;
          
          // 如果有话题ID，构造话题链接
          if (message_thread_id) {
            telegramMessageLink = `https://t.me/c/${cleanChatId}/${message_thread_id}/${message_id}`;
          } else {
            telegramMessageLink = `https://t.me/c/${cleanChatId}/${message_id}`;
          }
          
          friendlyUrl = `${url.origin}/file/${cleanChatId}/${message_id}`;
        }
        
        const encryptedUrl = `${url.origin}/file/${encrypted}`;
        
        // 保存到 D1
        if (FILE_DB && channelIdentifier) {
          try {
            const fileKey = `${channelIdentifier}/${message_id}`;
            const timestamp = Math.floor(Date.now() / 1000);
            
            await FILE_DB.prepare(
              'INSERT OR REPLACE INTO file_mappings (file_key, encrypted_data, created_at) VALUES (?, ?, ?)'
            ).bind(fileKey, encrypted, timestamp).run();
          } catch (error) {
            console.error('保存到 D1 失败:', error);
          }
        }
        
        return new Response(JSON.stringify({
          success: true,
          cdn: {
            url: friendlyUrl,
            url_encrypted: encryptedUrl,
            filename: filename,
            message_id: message_id,
            message_thread_id: message_thread_id || null,
            chat_id: chat_id,
            channel_identifier: channelIdentifier,
            size: fileSize || fileDataResponse.result.file_size,
            telegram_link: telegramMessageLink,
            markdown: `![${filename}](${friendlyUrl})`,
            html: `<img src="${friendlyUrl}" alt="${filename}" />`
          }
        }, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({
          error: '处理失败',
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
    if (!env.BOT_TOKEN) {
      return new Response(JSON.stringify({
        error: '服务未配置',
        message: '未设置 BOT_TOKEN 环境变量'
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const pathMatch = url.pathname.match(/^\/bot\/(.+)$/);
    
    if (!pathMatch) {
      return new Response(JSON.stringify({
        error: 'URL 格式错误',
        usage: '/bot/<方法名>',
        examples: [
          '/bot/sendMessage',
          '/bot/sendDocument',
          '/bot/sendPhoto'
        ],
        your_path: url.pathname,
        note: '不需要提供 token，已使用环境变量中的 BOT_TOKEN'
      }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const [, method] = pathMatch;
    const telegramUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;

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
                token: env.BOT_TOKEN,
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
              
              // 如果有 D1 数据库，保存映射
              if (FILE_DB && channelIdentifier) {
                try {
                  const fileKey = `${channelIdentifier}/${messageId}`;
                  const timestamp = Math.floor(Date.now() / 1000);
                  
                  await FILE_DB.prepare(
                    'INSERT OR REPLACE INTO file_mappings (file_key, encrypted_data, created_at) VALUES (?, ?, ?)'
                  ).bind(fileKey, encrypted, timestamp).run();
                  
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
                message_thread_id: result.message_thread_id || null,
                chat_id: chatId,
                channel_identifier: channelIdentifier,
                size: fileDataResponse.result.file_size,
                permanent: true,
                telegram_link: telegramMessageLink,
                markdown: `![${filename}](${friendlyUrl || encryptedUrl})`,
                html: `<img src="${friendlyUrl || encryptedUrl}" alt="${filename}" />`,
                note: FILE_DB && friendlyUrl
                  ? '链接永久有效，无需密码即可下载，可直接跳转到 Telegram 查看原消息'
                  : '加密链接永久有效（需要配置 D1 数据库才能使用友好链接）'
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
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ===== 解密函数 =====
async function decryptData(encryptedData, key) {
  const encoder = new TextEncoder();
  
  const padding = '='.repeat((4 - encryptedData.length % 4) % 4);
  const base64 = encryptedData
    .replace(/-/g, '+')
    .replace(/_/g, '/') + padding;
  
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