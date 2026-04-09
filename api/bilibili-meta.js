export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const input = req.query.url;
  if (!input || typeof input !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    let finalUrl = input.trim();

    // 解析 b23.tv 短链
    if (/b23\.tv/i.test(finalUrl)) {
      const shortResp = await fetch(finalUrl, {
        redirect: 'follow',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          referer: 'https://www.bilibili.com/',
        },
      });

      finalUrl = shortResp.url || finalUrl;
    }

    // 提取 BV 号
    const bvMatch =
      finalUrl.match(/\/video\/(BV[0-9A-Za-z]+)/i) ||
      finalUrl.match(/(^|\/)(BV[0-9A-Za-z]{10,})/i);

    if (!bvMatch) {
      return res.status(200).json({
        ok: false,
        platform: 'bilibili',
        url: finalUrl,
        cover: null,
        title: null,
        bv: null,
        error: 'BV id not found',
      });
    }

    const bv = bvMatch[1] && bvMatch[1].startsWith('BV') ? bvMatch[1] : bvMatch[2];
    const videoUrl = `https://www.bilibili.com/video/${bv}`;

    // 抓取视频页
    const pageResp = await fetch(videoUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        referer: 'https://www.bilibili.com/',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (!pageResp.ok) {
      return res.status(200).json({
        ok: false,
        platform: 'bilibili',
        url: videoUrl,
        cover: null,
        title: null,
        bv,
        error: `Failed to fetch page: ${pageResp.status}`,
      });
    }

    const html = await pageResp.text();

    // 提取 meta 信息
    const ogImage = matchMeta(html, 'og:image');
    const ogTitle = matchMeta(html, 'og:title');

    // 兜底从页面 JSON 里抓 pic
    const picRaw =
      html.match(/"pic":"(.*?)"/)?.[1] ||
      html.match(/"thumbnailUrl":\["(.*?)"\]/)?.[1] ||
      null;

    const titleRaw =
      html.match(/"title":"(.*?)"/)?.[1] ||
      html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] ||
      null;

    const cover = normalizeImageUrl(ogImage || decodeBiliString(picRaw));
    const title = cleanTitle(ogTitle || decodeBiliString(titleRaw));

    return res.status(200).json({
      ok: true,
      platform: 'bilibili',
      url: videoUrl,
      bv,
      cover,
      title,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Unknown error',
      cover: null,
      title: null,
    });
  }
}

function matchMeta(html, property) {
  if (!html) return null;

  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapeRegExp(property)}["'][^>]*>`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+name=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i'
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }

  return null;
}

function normalizeImageUrl(url) {
  if (!url) return null;

  let out = decodeHtml(url).trim();

  if (out.startsWith('//')) {
    out = `https:${out}`;
  }

  // 去掉 bilibili 常见转义
  out = out.replace(/\\u002F/g, '/').replace(/\\/g, '');

  return out || null;
}

function decodeBiliString(str) {
  if (!str) return null;

  return decodeHtml(
    str
      .replace(/\\u002F/g, '/')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&')
  );
}

function cleanTitle(title) {
  if (!title) return null;

  return decodeHtml(title)
    .replace(/\s*[-_|]\s*哔哩哔哩.*$/i, '')
    .replace(/\s*-\s*bilibili.*$/i, '')
    .trim();
}

function decodeHtml(str) {
  if (!str) return str;

  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
