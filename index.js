const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https'); // Required for handling HTTPS redirects

const app = express();

const nggUrl = 'https://now.gg';

const proxy = createProxyMiddleware({
    target: nggUrl,
    changeOrigin: true,
    secure: true,
    logLevel: 'debug',
    followRedirects: true, // Enable following redirects
    router: function (req) {
        if (req.headers.host === 'now.gg') {
            req.headers['X-Forwarded-For'] = '';
            req.headers['X-Real-IP'] = '';
            req.headers['Via'] = '';
        }
        return nggUrl;
    },
    //handle redirects
    onProxyRes: (proxyRes, req, res) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
            const location = proxyRes.headers.location;
            if (location) {
                console.log(`[${req.method}] ${req.url} -> Redirected to ${location} (Status: ${proxyRes.statusCode})`);

                //Check if the redirect is relative or absolute
                const targetUrl = new URL(location, nggUrl).href;

                // Use a separate request to handle the redirect.  Important for security and correct redirect handling.
                const redirectReq = (targetUrl.startsWith('https://')) ? https.request : require('http').request;

                const redirectOptions = {
                    method: 'GET', // Or the appropriate method from the original request
                    url: targetUrl,
                    headers: { ...req.headers, host: new URL(targetUrl).host }, // Important:  Set the 'host' header
                    followRedirects: true
                };

                const redirectRequest = redirectReq(targetUrl, (redirectResponse) => {
                    // Copy the headers and status code from the redirect response
                    res.writeHead(redirectResponse.statusCode, redirectResponse.headers);

                    // Pipe the redirect response body to the original response
                    redirectResponse.pipe(res);

                    redirectResponse.on('end', () => {
                       // console.log(`[${req.method}] ${req.url} -> Successfully handled redirect to ${targetUrl}`);
                    });
                    redirectResponse.on('error', (e) => {
                        console.error(`[${req.method}] ${req.url} -> Error during redirect: ${e.message}`);
                        res.end(`Error during redirect: ${e.message}`); // Send error to client
                    });

                });

                // Important: Handle errors on the redirect request
                redirectRequest.on('error', (err) => {
                    console.error(`[${req.method}] ${req.url} -> Error initiating redirect request: ${err.message}`);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end(`Error: ${err.message}`);
                });
                redirectRequest.end(); //send the request
            }
        }
    }
});

app.use('/', proxy);

const port = process.env.PORT || 443;
app.listen(port, () => {
    console.log(`CybriaGG is running on port ${port}`);
});
