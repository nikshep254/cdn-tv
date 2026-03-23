
// The URL of your raw M3U playlist on GitHub.
const M3U_URL = 'https://raw.githubusercontent.com/siam3310/cdn-tv/refs/heads/main/siamcdnplaylist.m3u';

// This is a Vercel Serverless Function.
// It will be accessible at the /api/proxy endpoint.
module.exports = async (req, res) => {
    // Get query parameters from the request URL.
    const { channel, url, referer } = req.query;

    try {
        // --- 1. Channel Request: Find the stream and redirect to the proxy ---
        if (channel) {
            const m3uResponse = await fetch(M3U_URL);
            if (!m3uResponse.ok) {
                return res.status(502).send('Error: Could not fetch the main playlist from GitHub.');
            }
            const m3uText = await m3uResponse.text();

            const lines = m3uText.split(/\r\n|\n|\r/);
            let streamUrl = '';
            let streamReferer = '';

            // Find the channel info in the playlist.
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXTINF:')) {
                    const parts = line.split(',');
                    const namePart = parts[parts.length - 1].trim();

                    if (namePart.toLowerCase() === channel.toLowerCase()) {
                        for (let j = i + 1; j < i + 3; j++) {
                            if (!lines[j]) continue;
                            const nextLine = lines[j].trim();
                            if (nextLine.startsWith('#EXTVLCOPT:http-referrer=')) {
                                streamReferer = nextLine.replace('#EXTVLCOPT:http-referrer=', '');
                            } else if (nextLine.startsWith('http')) {
                                streamUrl = nextLine;
                            }
                        }
                        if (streamUrl) break;
                    }
                }
            }

            if (!streamUrl) {
                return res.status(404).send(`Error: Channel "${channel}" not found.`);
            }

            // Build the redirect URL pointing back to this same serverless function.
            const proxyRedirectUrl = new URL(req.url, `https://${req.headers.host}`);
            proxyRedirectUrl.search = ''; // Clear existing query params
            proxyRedirectUrl.searchParams.set('url', streamUrl);
            if (streamReferer) {
                proxyRedirectUrl.searchParams.set('referer', streamReferer);
            }

            // Redirect the client to the proxy handler below.
            return res.redirect(302, proxyRedirectUrl.toString());
        }

        // --- 2. Proxy Request: Fetch the stream and send it to the client ---
        if (url) {
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            };
            if (referer) {
                headers['Referer'] = referer;
            }

            const targetResponse = await fetch(url, { headers });

            // Set CORS headers to allow the video player to access the stream.
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');

            // Pass through headers from the target stream (like Content-Type).
            targetResponse.headers.forEach((value, name) => {
                if (!['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].includes(name.toLowerCase())) {
                    res.setHeader(name, value);
                }
            });

            const contentType = targetResponse.headers.get('content-type') || '';

            // If it's a playlist, rewrite the URLs inside it.
            if (contentType.includes('mpegurl')) {
                const body = await targetResponse.text();
                const requestUrl = new URL(req.url, `https://${req.headers.host}`).toString();
                const rewrittenBody = rewritePlaylist(body, url, referer, requestUrl);
                return res.status(targetResponse.status).send(rewrittenBody);
            }

            // Otherwise, stream the video content directly to the client.
            res.status(targetResponse.status);
            return targetResponse.body.pipe(res);
        }

        // --- 3. Welcome Message ---
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send('Vercel M3U Proxy is active!\n\nUse /api/proxy?channel=CHANNEL_NAME to start a stream.');

    } catch (error) {
        console.error('Serverless Function Error:', error);
        res.status(500).send('An internal server error occurred.');
    }
};

// This helper function remains the same.
function rewritePlaylist(body, playlistUrl, referer, requestUrl) {
    const playlistBaseUrl = new URL(playlistUrl);
    const workerBaseUrl = new URL(requestUrl);
    workerBaseUrl.search = '';

    return body.trim().split(/\r\n|\n|\r/).map(line => {
        line = line.trim();
        if (!line) return '';

        if (line.startsWith('#')) {
            const uriMatch = line.match(/URI="([^"]+)"/);
            if (uriMatch && uriMatch[1]) {
                const absoluteUri = new URL(uriMatch[1], playlistBaseUrl).href;
                workerBaseUrl.searchParams.set('url', absoluteUri);
                if (referer) workerBaseUrl.searchParams.set('referer', referer);
                return line.replace(uriMatch[1], workerBaseUrl.toString());
            }
            return line;
        }

        const absoluteUrl = new URL(line, playlistBaseUrl).href;
        workerBaseUrl.searchParams.set('url', absoluteUrl);
        if (referer) workerBaseUrl.searchParams.set('referer', referer);
        return workerBaseUrl.toString();
    }).join('\n');
}
