const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');
const http = require('http'); // Import http

const app = express();
const nggUrl = 'https://now.gg';

const proxy = createProxyMiddleware({
    target: nggUrl,
    changeOrigin: true,
    secure: true,
    logLevel: 'debug',
    followRedirects: false, // Important:  We'll handle redirects manually for full control
    router: function (req) {
        if (req.headers.host === 'now.gg') {
            req.headers['X-Forwarded-For'] = '';
            req.headers['X-Real-IP'] = '';
            req.headers['Via'] = '';
        }
        return nggUrl;
    },
    onProxyRes: (proxyRes, req, res) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
            const location = proxyRes.headers.location;
            if (location) {
                console.log(`[${req.method}] ${req.url} -> Redirected to ${location} (Status: ${proxyRes.statusCode})`);

                let targetUrl;
                try {
                    targetUrl = new URL(location, nggUrl).href; // Resolve relative URLs
                } catch (e) {
                    console.error(`[${req.method}] ${req.url} -> Invalid redirect URL: ${location}`);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end(`Internal Server Error: Invalid redirect URL`);
                    return; // Stop processing this request
                }

                const redirectRequest = (targetUrl.startsWith('https://')) ? https.request : http.request; // Use http or https

                const redirectOptions = {
                    method: 'GET', //  Use GET for simplicity and to avoid potential issues with re-sending POST data.  This is the most robust approach for a general proxy.
                    url: targetUrl,
                    headers: { ...req.headers, host: new URL(targetUrl).host }, // Correct host header
                    followRedirects: false //  Do NOT let the underlying http/https client follow redirects.  We are in control.
                };

                const redirectReq = redirectRequest(targetUrl, (redirectRes) => {
                    // Copy headers and status code
                    res.writeHead(redirectRes.statusCode, redirectRes.headers);
                    redirectRes.pipe(res); // Pipe the data

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

                redirectReq.end(); // Start the redirect request

            } else {
                // No Location header, but it's a 3xx response.  This is an error.
                console.error(`[${req.method}] ${req.url} -> 3xx response without Location header`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end("Internal Server Error: 3xx response without Location header");
            }
        } else {
            // Not a redirect, so just pipe the original proxy response
            proxyRes.pipe(res);
        }
    }
});

app.use('/', proxy);

const port = process.env.PORT || 443;
app.listen(port, () => {
    console.log(`CybriaGG is running on port ${port}`);
});
