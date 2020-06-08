const http = require('http');
const querystring = require('querystring');
const url = require('url');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const { importPhotos } = require('./flickrimport');

async function authMiddleware(req, res) {
  const qs = querystring.parse(url.parse(req.url).query);
  const oAuth2Client = new OAuth2Client(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    [process.env.REDIRECT_URI],
  );

  if (req.headers.cookie) {
    const tokens = JSON.parse(req.headers.cookie.split('=')[1]);
    oAuth2Client.setCredentials(tokens);
  } else if (qs.code) {
    const tokensResp = await oAuth2Client.getToken(qs.code);
    oAuth2Client.setCredentials(tokensResp.tokens);
    res.setHeader(
      'Set-Cookie',
      `token=${JSON.stringify(
        tokensResp.tokens,
      )}; Max-Age=2147483647;  HttpOnly`,
    );
  } else {
    const authorizeUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: 'https://www.googleapis.com/auth/photoslibrary',
      prompt: 'consent',
    });
    res.setHeader('Location', authorizeUrl);
    res.statusCode = 302;
    return res.end();
  }

  importPhotos(oAuth2Client);
}

http
  .createServer(async (req, res) => {
    try {
      const parsedUrl = url.parse(req.url);
      await authMiddleware(req, res);
      if (parsedUrl.pathname === '/' && !res.finished) {
        res.end('Beginning import');
      } else {
        res.statusCode = 404;
        res.end();
      }
    } catch (err) {
      res.statusCode = 500;
      res.end(err.toString());
    }
  })
  .listen(process.env.PORT, () => {
    const pjson = require('./package.json');
    console.log(
      `FlickrImport ${pjson.version} listening on port`,
      process.env.PORT,
    );
  });
