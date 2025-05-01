const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');
const http = require('http');

const app = express();
const nggUrl = 'https://now.gg';

const proxy = createProxyMiddleware({
    target: nggUrl,
    changeOrigin: true,
    secure: true,
    logLevel: 'debug',
    followRedirects: false,
    router: function (req) {
        if (req.headers.host === 'now.gg') {
            req.headers['X-Forwarded-For'] = '';
            req.headers['X-Real-IP'] = '';
            req.headers['Via'] = '';
        }
        return nggUrl;
    },
    onProxyRes: (proxyRes, req, res) => {
        // Remove problematic headers to prevent content encoding errors
        delete proxyRes.headers['content-encoding'];
        delete proxyRes.headers['transfer-encoding'];

        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
            if (proxyRes.statusCode === 304) {
                console.log(`[${req.method}] ${req.url} -> 304 Not Modified`);
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                res.end();
                return;
            }

            const location = proxyRes.headers.location;
            if (location) {
                console.log(`[${req.method}] ${req.url} -> Redirected to ${location} (Status: ${proxyRes.statusCode})`);

                let targetUrl;
                try {
                    targetUrl = new URL(location, nggUrl).href;
                } catch (e) {
                    console.error(`[${req.method}] ${req.url} -> Invalid redirect URL: ${location}`);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end(`Internal Server Error: Invalid redirect URL: ${location}`);
                    return;
                }

                const redirectRequest = (targetUrl.startsWith('https://')) ? https.request : http.request;

                const redirectOptions = {
                    method: 'GET',
                    url: targetUrl,
                    headers: { ...req.headers, host: new URL(targetUrl).host },
                    followRedirects: false
                };

                const redirectReq = redirectRequest(targetUrl, (redirectRes) => {
                    // Remove content-encoding and transfer-encoding headers from the redirect response as well
                    delete redirectRes.headers['content-encoding'];
                    delete redirectRes.headers['transfer-encoding'];
                    res.writeHead(redirectRes.statusCode, redirectRes.headers);
                    redirectRes.pipe(res);

                    redirectRes.on('end', () => {
                        console.log(`[${req.method}] ${req.url} -> Successfully handled redirect to ${targetUrl}`);
                    });

                    redirectRes.on('error', (err) => {
                        console.error(`[${req.method}] ${req.url} -> Error during redirect: ${err.message}`);
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end(`Error during redirect: ${err.message}`);
                    });
                });

                redirectReq.on('error', (err) => {
                    console.error(`[${req.method}] ${req.url} -> Error initiating redirect request: ${err.message}`);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end(`Error: ${err.message}`);
                });

                redirectReq.end();

            } else {
                // No Location header, but it's a 3xx response.  This is an error.
                console.error(`[${req.method}] ${req.url} -> 3xx response without Location header.  Status Code: ${proxyRes.statusCode}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Internal Server Error: 3xx response without Location header. Status Code: ${proxyRes.statusCode}`);
            }
        } else {
            // Remove content-encoding and transfer-encoding headers from the original response too
            delete proxyRes.headers['content-encoding'];
            delete proxyRes.headers['transfer-encoding'];
            proxyRes.pipe(res);
        }
    }
});

app.use('/', proxy);

const port = process.env.PORT || 443;
app.listen(port, () => {
    console.log(`CybriaGG is running on port ${port}`);
});
