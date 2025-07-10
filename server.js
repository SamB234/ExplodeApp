// server.js
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(session({
  secret: 'onshape-secret',
  resave: false,
  saveUninitialized: true,
}));

const PORT = process.env.PORT || 3000;

// ENV vars you’ll need:
// ONSHAPE_CLIENT_ID
// ONSHAPE_CLIENT_SECRET
// ONSHAPE_REDIRECT_URI

const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_URL = 'https://cad.onshape.com/api';

app.get('/', (req, res) => {
  res.send('Onshape Connected App Backend');
});

app.get('/auth', (req, res) => {
  const redirectUrl = `${ONSHAPE_AUTH_URL}?response_type=code&client_id=${process.env.ONSHAPE_CLIENT_ID}&redirect_uri=${process.env.ONSHAPE_REDIRECT_URI}&scope=OAuth2Read+OAuth2Write`;
  res.redirect(redirectUrl);
});

app.get('/oauth-callback', async (req, res) => {
  const { code } = req.query;
  try {
    const response = await axios.post(ONSHAPE_TOKEN_URL, null, {
      params: {
        grant_type: 'authorization_code',
        code,
        client_id: process.env.ONSHAPE_CLIENT_ID,
        client_secret: process.env.ONSHAPE_CLIENT_SECRET,
        redirect_uri: process.env.ONSHAPE_REDIRECT_URI,
      },
    });

    req.session.access_token = response.data.access_token;
    res.redirect('/dashboard'); // Or wherever you want to go next
  } catch (error) {
    console.error('OAuth Callback Error:', error.response?.data || error.message);
    res.status(500).send('OAuth failed');
  }
});

app.get('/api/mates/:documentId/:workspaceId/:elementId', async (req, res) => {
  const { documentId, workspaceId, elementId } = req.params;

  if (!req.session.access_token) {
    return res.status(401).send('Not authenticated');
  }

  try {
    const response = await axios.get(`${ONSHAPE_API_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/mates`, {
      headers: {
        Authorization: `Bearer ${req.session.access_token}`,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error('Mate fetch error:', error.response?.data || error.message);
    res.status(500).send('Failed to fetch mates');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
