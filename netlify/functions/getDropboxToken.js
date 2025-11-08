// netlify/functions/getDropboxToken.js
export async function handler() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const clientId = '8hyi00z3tgw4419';
  const clientSecret = 'fii9xrqzj0nghtv';

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  const data = await response.json();
  return {
    statusCode: 200,
    body: JSON.stringify({ access_token: data.access_token })
  };
}
