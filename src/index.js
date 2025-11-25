// Cloudflare Workers - Telegram Bot API 代理
// 支持文件上传和所有 Telegram Bot API 方法

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 提取路径参数：/bot<token>/<method>
    const pathMatch = url.pathname.match(/^\/bot([^\/]+)\/(.+)$/);
    
    if (!pathMatch) {
      return new Response(JSON.stringify({
        error: 'Invalid URL format',
        usage: '/bot<TOKEN>/<METHOD>',
        example: '/bot123456:ABC-DEF/sendMessage'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const [, token, method] = pathMatch;
    const telegramUrl = `https://api.telegram.org/bot${token}/${method}`;

    try {
      // 构建转发请求
      const proxyRequest = new Request(telegramUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' 
          ? request.body 
          : null
      });

      // 转发到 Telegram API
      const response = await fetch(proxyRequest);
      
      // 返回响应
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });

    } catch (error) {
      return new Response(JSON.stringify({
        error: 'Proxy failed',
        detail: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
