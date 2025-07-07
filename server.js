const path = require('path');
const fastify = require('fastify')({ logger: true });
const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const fastifyCookie = require('@fastify/cookie');
const fastifySession = require('@fastify/session');
const handlebars = require('handlebars');
const fetch = require('node-fetch');

require('dotenv').config();

const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6';

handlebars.registerHelper('json', function (context) {
  return JSON.stringify(context, null, 2);
});

fastify.register(fastifyCookie);
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || 'a-very-secret-key',
  cookie: { secure: false }, // set secure: true if using HTTPS in prod
  saveUninitialized: false,
});

fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
});

fastify.register(fastifyFormbody);

fastify.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, 'src/pages'),
  layout: false,
});

// Middleware to refresh access token if expired
async function ensureValidToken(request, reply, done) {
  const session = request.session;
  if (!session.access_token || !session.expires_at) {
    // No token at all
    return reply.redirect('/oauthStart');
  }

  const now = Date.now();
  if (now > session.expires_at - 60000) {
    // Token expired or about to expire in 1 minute, refresh it
    try {
      const res = await fetch(ONSHAPE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization':
            'Basic ' +
            Buffer.from(
              `${process.env.ONSHAPE_CLIENT_ID}:${process.env.ONSHAPE_CLIENT_SECRET}`
            ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: session.refresh_token,
        }),
      });

      if (!res.ok) {
        fastify.log.error('Failed to refresh token', await res.text());
        return reply.redirect('/oauthStart');
      }

      const data = await res.json();

      session.access_token = data.access_token;
      session.refresh_token = data.refresh_token || session.refresh_token;
      session.expires_at = Date.now() + data.expires_in * 1000;
      await session.save();

      done();
    } catch (err) {
      fastify.log.error('Error refreshing token:', err);
      return reply.redirect('/oauthStart');
    }
  } else {
    done();
  }
}

// Home route: expects query params from Onshape launch
fastify.get('/', async (request, reply) => {
  const { d, w, e } = request.query;

  // If no token in session, prompt OAuth start
  if (!request.session.access_token) {
    return reply.view('index.hbs', {
      title: 'Onshape Exploded View App',
      message: 'Please authorize the app first.',
      oauthUrl: '/oauthStart',
    });
  }

  // Render assembly view with doc/workspace/element and token from session
  return reply.view('assembly_view.hbs', {
    title: 'Exploded View',
    documentId: d || '',
    workspaceId: w || '',
    elementId: e || '',
    accessToken: request.session.access_token,
  });
});

// API: Get assembly data, uses stored access token and refreshes if needed
fastify.get('/api/assemblydata', { preHandler: ensureValidToken }, async (request, reply) => {
  const { d, w, e } = request.query;

  if (!d || !w || !e) {
    return reply.status(400).send('Missing document context parameters.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/assemblydefinition`;
  const headers = {
    Authorization: `Bearer ${request.session.access_token}`,
    Accept: 'application/json',
  };

  try {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`Onshape API error: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/assemblydata:', err);
    return reply.status(500).send('Internal Server Error.');
  }
});

// API: Get GLTF model, uses stored access token and refreshes if needed
fastify.get('/api/gltf-model', { preHandler: ensureValidToken }, async (request, reply) => {
  const { d, w, e } = request.query;

  if (!d || !w || !e) {
    return reply.status(400).send('Missing document context parameters for GLTF model.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${d}/w/${w}/e/${e}/gltf?outputFacetSettings=true&mode=flat`;
  const headers = {
    Authorization: `Bearer ${request.session.access_token}`,
    Accept: 'model/gltf+json',
  };

  try {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`GLTF fetch failed: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error fetching GLTF: ${errorText}`);
    }

    reply.header('Content-Type', 'model/gltf+json');
    // Stream the response body
    return reply.send(res.body);
  } catch (err) {
    fastify.log.error('Error in /api/gltf-model:', err);
    return reply.status(500).send('Internal Server Error fetching GLTF model.');
  }
});

// Start OAuth flow
fastify.get('/oauthStart', async (request, reply) => {
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const redirectUri = process.env.ONSHAPE_REDIRECT_URI;
  const scope = 'OAuth2ReadPII OAuth2Read OAuth2Write';
  const state = 'state123'; // You can implement proper CSRF state token here

  if (!clientId || !redirectUri) {
    return reply.status(500).send('Missing ONSHAPE_CLIENT_ID or ONSHAPE_REDIRECT_URI.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state,
  });

  return reply.redirect(`${ONSHAPE_AUTH_URL}?${params.toString()}`);
});

// OAuth redirect callback to exchange code for tokens
fastify.get('/oauthRedirect', async (request, reply) => {
  const { code, state } = request.query;

  if (!code) return reply.status(400).send('Missing authorization code.');

  try {
    const clientId = process.env.ONSHAPE_CLIENT_ID;
    const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;
    const redirectUri = process.env.ONSHAPE_REDIRECT_URI;

    const res = await fetch(ONSHAPE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      fastify.log.error('Token exchange failed:', res.status, data);
      return reply.status(res.status).send(`Token exchange failed: ${data.error_description || JSON.stringify(data)}`);
    }

    const data = await res.json();

    // Save tokens and expiration in session
    request.session.access_token = data.access_token;
    request.session.refresh_token = data.refresh_token;
    request.session.expires_at = Date.now() + data.expires_in * 1000;
    await request.session.save();

    // Redirect to home or app page
    return reply.redirect('/');
  } catch (err) {
    fastify.log.error('OAuth redirect error:', err);
    return reply.status(500).send('Token exchange failed due to server error.');
  }
});

// List documents example (optional)
fastify.get('/listDocuments', { preHandler: ensureValidToken }, async (request, reply) => {
  try {
    const res = await fetch(`${ONSHAPE_API_BASE_URL}/documents`, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const error = await res.json();
      fastify.log.error('Error fetching documents:', error);
      return reply.status(res.status).send(`Failed to fetch documents: ${error.message}`);
    }

    const documents = await res.json();
    return reply.view('documents.hbs', { documents });
  } catch (err) {
    fastify.log.error('Error fetching documents:', err);
    return reply.status(500).send('Server error while fetching documents.');
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    fastify.log.info(`Server running on port ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
