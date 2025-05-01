const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');
const http = require('http');
const zlib = require('zlib'); // For handling decompression

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
        // Remove problematic headers
        delete proxyRes.headers['content-encoding'];
        delete proxyRes.headers['transfer-encoding'];

        // Array to store the response data chunks
        let responseData = [];

        // Function to handle decompression based on original encoding
        const handleDecompression = (data, encoding) => {
            try {
                if (encoding === 'gzip') {
                    return zlib.gunzipSync(data);
                } else if (encoding === 'deflate') {
                    return zlib.inflateRawSync(data); // Use inflateRaw for deflate
                } else if (encoding === 'br') {
                    return zlib.brotliDecompressSync(data);
                } else {
                    return data; // No decompression needed
                }
            } catch (error) {
                console.error(`[${req.method}] ${req.url} -> Decompression error: ${error.message}`);
                return Buffer.from(`Error decompressing response: ${error.message}`, 'utf-8');
            }
        };

        proxyRes.on('data', (chunk) => {
            responseData.push(chunk);
        });

        proxyRes.on('end', () => {
            const fullData = Buffer.concat(responseData);
            const encoding = proxyRes.headers['original-content-encoding'] || proxyRes.headers['content-encoding']; // Check for original
            const decompressedData = handleDecompression(fullData, encoding);

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
                        delete redirectRes.headers['content-encoding'];
                        delete redirectRes.headers['transfer-encoding'];
                        let redirectResponseData = [];

                        redirectRes.on('data', (chunk) => {
                            redirectResponseData.push(chunk);
                        });

                        redirectRes.on('end', () => {
                            const fullRedirectData = Buffer.concat(redirectResponseData);
                            const redirectEncoding = redirectRes.headers['original-content-encoding'] || redirectRes.headers['content-encoding'];
                            const decompressedRedirectData = handleDecompression(fullRedirectData, redirectEncoding);
                            res.writeHead(redirectRes.statusCode, redirectRes.headers);
                            res.end(decompressedRedirectData);
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
                    console.error(`[${req.method}] ${req.url} -> 3xx response without Location header.  Status Code: ${proxyRes.statusCode}`);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end(`Internal Server Error: 3xx response without Location header. Status Code: ${proxyRes.statusCode}`);
                }
            } else {
                //  Send the decompressed data
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                res.end(decompressedData);
            }
        });

        proxyRes.on('error', (err) => {
            console.error(`[${req.method}] ${req.url} -> proxyRes error:  ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Proxy Error: ${err.message}`);
        });
    }
});

app.use('/', proxy);

const port = process.env.PORT || 443;
app.listen(port, () => {
    console.log(`CybriaGG is running on port ${port}`);
});
