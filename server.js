const express = require('express');
const session = require('express-session');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const hbs = require('hbs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Set up Handlebars view engine
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'src/pages'));

// Serve static files like CSS
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(express.json());
app.use(cors());
app.use(session({
  secret: 'onshape-secret',
  resave: false,
  saveUninitialized: true,
}));

// ENV vars you’ll need in your .env:
// ONSHAPE_CLIENT_ID
// ONSHAPE_CLIENT_SECRET
// ONSHAPE_REDIRECT_URI

const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_URL = 'https://cad.onshape.com/api';

// Routes
app.get('/', (req, res) => {
  res.render('index'); // renders src/pages/index.hbs
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
    res.redirect('/documents'); // Or wherever you want to go next
  } catch (error) {
    console.error('OAuth Callback Error:', error.response?.data || error.message);
    res.render('error', { message: 'OAuth failed' });
  }
});

app.get('/documents', (req, res) => {
  if (!req.session.access_token) {
    return res.redirect('/auth');
  }

  // Just a placeholder page for now
  res.render('documents');
});

app.get('/assembly-view', (req, res) => {
  if (!req.session.access_token) {
    return res.redirect('/auth');
  }

  res.render('assembly_view');
});

// Example API route
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
