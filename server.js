const path = require('path');
const fastify = require('fastify')({ logger: true });
const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const fastifyCookie = require('@fastify/cookie');
const fastifySession = require('@fastify/session');
const handlebars = require('handlebars');
const fetch = require('node-fetch');
const fastifyHelmet = require('@fastify/helmet'); // ✅ Import helmet

require('dotenv').config();

const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6';

handlebars.registerHelper('json', function (context) {
  return JSON.stringify(context, null, 2);
});

fastify.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: [
  "https://*.dev.graebert.com",
  "https://*.onshape.io",
  "https://td.doubleclick.net",
  "https://js.stripe.com",
  "https://www.recaptcha.net",
  "https://*.onshape.com",
  "https://fast.wistia.net",
  "https://fast.wistia.com",
  "https://www.youtube.com",
  "https://js.driftt.com",
  "https://www.googletagmanager.com",
  "https://explodeapp.onrender.com",
  "https://explodeapp.onrender.com/oauthStart"      
      ],
      objectSrc: ["'none'"], // ✅ Hardened
      baseUri: ["'self'"],
      workerSrc: ["'self'", "blob:"],
    },
    reportOnly: false
  }
});

fastify.register(fastifyCookie);
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || 'a-very-secret-key',
  cookie: { secure: false },
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

// *** Key Fix: make ensureValidToken async, remove done callback ***
async function ensureValidToken(request, reply) {
  const session = request.session;
  if (!session || !session.access_token || !session.expires_at) {
    return reply.redirect('/oauthStart');
  }

  const now = Date.now();
  if (now > session.expires_at - 60000) {
    try {
      const res = await fetch(ONSHAPE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization':
            'Basic ' +
            Buffer.from(`${process.env.ONSHAPE_CLIENT_ID}:${process.env.ONSHAPE_CLIENT_SECRET}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: session.refresh_token,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to refresh token: ${res.statusText}`);
      }
      const data = await res.json();

      session.access_token = data.access_token;
      session.refresh_token = data.refresh_token || session.refresh_token;
      session.expires_at = Date.now() + data.expires_in * 1000;

      await session.save();
      // No done() because this is async preHandler
    } catch (err) {
      console.error('Error refreshing token:', err);
      return reply.redirect('/oauthStart');
    }
  }
  // If token still valid, or after refresh, just continue
}

// Helper to extract document params from query
function extractDocumentParams(query) {
  return {
    documentId: query.d || query.documentId,
    workspaceId: query.w || query.workspaceId,
    elementId: query.e || query.elementId,
  };
}

fastify.get('/', async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);

  if (!request.session.access_token) {
    return reply.view('index.hbs', {
      title: 'Onshape Exploded View App',
      message: 'Please authorize the app first.',
      oauthUrl: '/oauthStart',
    });
  }

  return reply.view('assembly_view.hbs', {
    title: 'Exploded View',
    documentId,
    workspaceId,
    elementId,
    accessToken: request.session.access_token,
  });
});

fastify.get('/api/assemblydata', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/assemblydefinition`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

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

fastify.get('/api/gltf-model', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters for GLTF model.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/gltf?outputFacetSettings=true&mode=flat`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'model/gltf+json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`GLTF fetch failed: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error fetching GLTF: ${errorText}`);
    }

    reply.header('Content-Type', 'model/gltf+json');
    return reply.send(res.body);
  } catch (err) {
    fastify.log.error('Error in /api/gltf-model:', err);
    return reply.status(500).send('Internal Server Error fetching GLTF model.');
  }
});

// Exploded view config
fastify.get('/api/exploded-config', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters for exploded config.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/explodedviews`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`Exploded config error: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/exploded-config:', err);
    return reply.status(500).send('Internal Server Error fetching exploded config.');
  }
});

// Mates
fastify.get('/api/mates', { preHandler: ensureValidToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters for mates.');
  }

  const url = `${ONSHAPE_API_BASE_URL}/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/mates`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      fastify.log.error(`Mate fetch error: ${res.status} ${errorText}`);
      return reply.status(res.status).send(`Error: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/mates:', err);
    return reply.status(500).send('Internal Server Error fetching mates.');
  }
});

// OAuth start
fastify.get('/oauthStart', async (request, reply) => {
  const redirectUri = encodeURIComponent(process.env.OAUTH_REDIRECT_URI);
  const url = `${ONSHAPE_AUTH_URL}?response_type=code&client_id=${process.env.ONSHAPE_CLIENT_ID}&redirect_uri=${redirectUri}&scope=read+write&state=xyz`;
  return reply.redirect(url);
});

// OAuth callback
fastify.get('/oauthCallback', async (request, reply) => {
  const { code, state } = request.query;
  if (!code) {
    return reply.status(400).send('Missing code parameter');
  }

  try {
    const res = await fetch(ONSHAPE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${process.env.ONSHAPE_CLIENT_ID}:${process.env.ONSHAPE_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.OAUTH_REDIRECT_URI,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return reply.status(res.status).send(`Token exchange failed: ${errorText}`);
    }

    const data = await res.json();
    request.session.access_token = data.access_token;
    request.session.refresh_token = data.refresh_token;
    request.session.expires_at = Date.now() + data.expires_in * 1000;
    await request.session.save();

    return reply.redirect('/');
  } catch (err) {
    fastify.log.error('OAuth callback error:', err);
    return reply.status(500).send('OAuth callback failed');
  }
});

const PORT = process.env.PORT || 3000;
fastify.listen(PORT, '0.0.0.0', (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Server listening at ${address}`);
});
