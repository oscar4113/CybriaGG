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
        let responseSent = false; // Track if response has been sent

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
            if (responseSent) {
                console.warn(`[${req.method}] ${req.url} -> Response already sent, skipping.`);
                return; // Prevent multiple sends
            }
            responseSent = true;
            let fullData;
            try{
                fullData = Buffer.concat(responseData);
            } catch(error){
                console.error(`[${req.method}] ${req.url} -> Error concatenating data: ${error.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Internal Server Error: Error concatenating response data.`);
                return;
            }

            const encoding = proxyRes.headers['original-content-encoding'] || proxyRes.headers['content-encoding']; // Check for original
            let decompressedData;
            try {
                decompressedData = handleDecompression(fullData, encoding);
            } catch (error) {
                console.error(`[${req.method}] ${req.url} -> Decompression failed: ${error.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Internal Server Error: Decompression Failed`);
                return;
            }


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


                    const redirectReq = redirectRequest(targetUrl, (redirectRes) => {
                        delete redirectRes.headers['content-encoding'];
                        delete redirectRes.headers['transfer-encoding'];
                        let redirectResponseData = [];
                        let redirectResponseSent = false;

                        redirectRes.on('data', (chunk) => {
                            redirectResponseData.push(chunk);
                        });

                        redirectRes.on('end', () => {
                            if (redirectResponseSent) {
                                 console.warn(`[${req.method}] ${req.url} -> Redirect Response already sent, skipping.`);
                                return;
                            }
                            redirectResponseSent = true;
                            let fullRedirectData;
                             try{
                                fullRedirectData = Buffer.concat(redirectResponseData);
                            } catch(error){
                                console.error(`[${req.method}] ${req.url} -> Error concatenating redirect data: ${error.message}`);
                                res.writeHead(500, { 'Content-Type': 'text/plain' });
                                res.end(`Internal Server Error: Error concatenating redirect response data.`);
                                return;
                            }
                            const redirectEncoding = redirectRes.headers['original-content-encoding'] || redirectRes.headers['content-encoding'];
                            let decompressedRedirectData;
                            try{
                                decompressedRedirectData = handleDecompression(fullRedirectData, redirectEncoding);
                            } catch(error) {
                                console.error(`[${req.method}] ${req.url} -> Decompression error during redirect: ${error.message}`);
                                res.writeHead(500, { 'Content-Type': 'text/plain' });
                                res.end(`Internal Server Error: Decompression error during redirect.`);
                                return;
                            }
                            res.writeHead(redirectRes.statusCode, redirectRes.headers);
                            res.end(decompressedRedirectData);
                            console.log(`[${req.method}] ${req.url} -> Successfully handled redirect to ${targetUrl}`);
                        });

                        redirectRes.on('error', (err) => {
                            console.error(`[${req.method}] ${req.url} -> Error during redirect: ${err.message}`);
                            if (!redirectResponseSent) {
                                redirectResponseSent = true;
                                res.writeHead(500, { 'Content-Type': 'text/plain' });
                                res.end(`Error during redirect: ${err.message}`);
                            }

                        });
                    });
                    const redirectOptions = {
                        method: 'GET',
                        url: targetUrl,
                        headers: { ...req.headers, host: new URL(targetUrl).host },
                        followRedirects: false
                    };

                    redirectReq.on('error', (err) => {
                        console.error(`[${req.method}] ${req.url} -> Error initiating redirect request: ${err.message}`);
                        if (!responseSent) {
                            responseSent = true;
                            res.writeHead(500, { 'Content-Type': 'text/plain' });
                            res.end(`Error: ${err.message}`);
                        }
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
            if (!responseSent) {
                responseSent = true;
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Error: ${err.message}`);
            }
        });
    }
});

app.use('/', proxy);

const port = process.env.PORT || 443;
app.listen(port, () => {
    console.log(`CybriaGG is running on port ${port}`);
});
