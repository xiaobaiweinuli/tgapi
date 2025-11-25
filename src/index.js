// Cloudflare Workers - Telegram Bot API 代理
// 支持文件上传和所有 Telegram Bot API 方法

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // 根路径返回使用说明
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(JSON.stringify({
        service: 'Telegram Bot API Proxy',
        usage: '/bot<TOKEN>/<METHOD>',
        examples: [
          '/bot123456:ABC-DEF/sendMessage?chat_id=123&text=Hello',
          '/bot123456:ABC-DEF/sendDocument (POST with multipart/form-data)'
        ],
        features: [
          'Full Telegram Bot API support',
          'File upload support (up to 100MB)',
          'GET and POST methods',
          'Multipart form data support'
        ],
        limits: {
          max_file_size: '100MB (Cloudflare Workers free tier)',
          telegram_limit: '50MB (Telegram Bot API)'
        }
      }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // 提取路径参数：支持 /bot<token>/<method> 和 /bot/<token>/<method>
    let pathMatch = url.pathname.match(/^\/bot\/?([^\/]+)\/(.+)$/);
    
    if (!pathMatch) {
      return new Response(JSON.stringify({
        error: 'Invalid URL format',
        usage: '/bot<TOKEN>/<METHOD> or /bot/<TOKEN>/<METHOD>',
        examples: [
          '/bot123456:ABC-DEF/sendMessage',
          '/bot/123456:ABC-DEF/sendMessage'
        ],
        your_path: url.pathname
      }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const [, token, method] = pathMatch;
    const telegramUrl = `https://api.telegram.org/bot${token}/${method}`;

    try {
      // 复制请求头，但排除一些 Cloudflare 特定的头
      const headers = new Headers(request.headers);
      
      // 移除可能导致问题的头
      headers.delete('cf-connecting-ip');
      headers.delete('cf-ray');
      headers.delete('cf-visitor');
      headers.delete('cf-ipcountry');
      
      // 如果是 GET 请求且有查询参数，添加到 URL
      let finalUrl = telegramUrl;
      if (request.method === 'GET' && url.search) {
        finalUrl = `${telegramUrl}${url.search}`;
      }

      // 构建转发请求
      const proxyRequest = new Request(finalUrl, {
        method: request.method,
        headers: headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' 
          ? request.body 
          : null,
        // 保持流式传输，对大文件很重要
        duplex: 'half'
      });

      // 记录请求（可选，用于调试）
      console.log(`[${new Date().toISOString()}] ${request.method} ${method}`);

      // 转发到 Telegram API
      const response = await fetch(proxyRequest);
      
      // 复制响应头
      const responseHeaders = new Headers(response.headers);
      
      // 添加 CORS 头
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type');
      
      // 返回响应
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (error) {
      console.error('Proxy error:', error);
      
      return new Response(JSON.stringify({
        error: 'Proxy failed',
        detail: error.message,
        method: method,
        timestamp: new Date().toISOString(),
        tip: 'Check if your bot token is correct and the method is supported by Telegram Bot API'
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};