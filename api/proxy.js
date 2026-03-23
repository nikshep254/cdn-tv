// Vercel Serverless Function: /api/proxy
// This is a PURE PROXY. It only knows how to fetch a URL with a given Referer.
// All business logic is handled by the client.

// Helper to rewrite playlist URLs to point back to our proxy
function rewritePlaylist(body, sourceUrl, referer, host) {
    const sourceBaseUrl = new URL(sourceUrl);
    const proxyBase = `https://${host}/api/proxy`;

    return body.trim().split(/\r\n|\n|\r/).map(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) {
            return line; // Keep comments and empty lines
        }

        // The line is a URL (sub-playlist or video segment)
        const absoluteUrl = new URL(line, sourceBaseUrl);
        const proxyUrl = new URL(proxyBase);
        proxyUrl.searchParams.set('url', absoluteUrl.href);
        if (referer) {
            proxyUrl.searchParams.set('referer', referer);
        }
        return proxyUrl.href;

    }).join('\n');
}

// Main handler
module.exports = async (req, res) => {
    const { url, referer } = req.query;
    const host = req.headers.host;

    if (!url) {
        return res.status(200).send('Pure M3U Proxy is active. Please provide a `url` parameter.');
    }

    try {
        // 1. Construct headers for the target request
        const requestHeaders = {};
        // Copy safe headers from the original client request
        Object.keys(req.headers).forEach(header => {
            if (!['host', 'cookie', 'referer'].includes(header.toLowerCase())) {
                requestHeaders[header] = req.headers[header];
            }
        });
        // Set a standard User-Agent
        requestHeaders['User-Agent'] = 'VLC/3.0.0';
        // Set the crucial Referer header if provided
        if (referer) {
            requestHeaders['Referer'] = referer;
        }

        // 2. Fetch the content from the target URL
        const response = await fetch(url, { headers: requestHeaders });

        if (!response.ok) {
            console.error(`Fetch Error: ${response.status} ${response.statusText} for URL: ${url}`)
            return res.status(response.status).send(`Error fetching content: ${response.statusText}`);
        }

        // 3. Process the response
        const contentType = response.headers.get('content-type') || '';

        // If it's a playlist, it needs rewriting
        if (contentType.includes('mpegurl') || contentType.includes('x-mpegurl')) {
            const body = await response.text();
            const rewrittenBody = rewritePlaylist(body, url, referer, host);
            res.setHeader('Content-Type', contentType);
            return res.status(200).send(rewrittenBody);
        } else {
            // For all other content (like .ts segments), pipe the stream directly.
            // Forward all headers from the origin response (like Content-Length)
            response.headers.forEach((value, name) => {
                res.setHeader(name, value);
            });
            return response.body.pipe(res);
        }

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).send('An internal server error occurred.');
    }
};
