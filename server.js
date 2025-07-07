// server.js — for Onshape App Element (assembly use only)

const fastify = require('fastify')({ logger: true });
const path = require('path');
const pointOfView = require('@fastify/view');
const handlebars = require('handlebars');
const fastifyCookie = require('@fastify/cookie');
const fastifySession = require('@fastify/session');
const dotenv = require('dotenv');
const fastifyStatic = require('@fastify/static');

// Load environment variables from .env
dotenv.config();

// Register view engine — no layout.hbs (was causing issues)
fastify.register(pointOfView, {
  engine: {
    handlebars: handlebars,
  },
  root: path.join(__dirname, 'src/pages'),
  viewExt: 'hbs',
});

// Serve static files (CSS, client-side JS, etc.)
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
});

// Session and cookie handling
fastify.register(fastifyCookie);
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || 'a very secret value',
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 1000 * 60 * 60, // 1 hour
  },
  saveUninitialized: false,
});

// OAuth 2.0 endpoint to begin login flow
fastify.get('/oauthStart', async (request, reply) => {
  const clientId = process.env.CLIENT_ID;
  const callbackUri = process.env.REDIRECT_URI;

  const redirectUri = `https://oauth.onshape.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(callbackUri)}&scope=openid`;

  reply.redirect(redirectUri);
});

// OAuth callback
fastify.get('/oauthCallback', async (request, reply) => {
  const code = request.query.code;
  const redirectUri = process.env.REDIRECT_URI;

  try {
    const response = await fastify.inject({
      method: 'POST',
      url: 'https://oauth.onshape.com/oauth/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization:
          'Basic ' +
          Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64'),
      },
      payload: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    });

    const data = JSON.parse(response.body);
    request.session.access_token = data.access_token;

    reply.redirect('/');
  } catch (err) {
    request.log.error(err);
    reply.code(500).send('OAuth Error');
  }
});

// Home route: expects query params from Onshape launch
fastify.get('/', async (request, reply) => {
  fastify.log.info('Query parameters received:', request.query);

  const { d, w, e } = request.query;

  // If no token in session, prompt OAuth start
  if (!request.session.access_token) {
    return reply.view('index', {
      title: 'Onshape Exploded View App',
      message: 'Please authorize the app first.',
      oauthUrl: '/oauthStart',
    });
  }

  // Render assembly view with doc/workspace/element and token from session
  return reply.view('assembly_view', {
    title: 'Exploded View',
    documentId: d || '',
    workspaceId: w || '',
    elementId: e || '',
    accessToken: request.session.access_token,
  });
});

// Optional route for documents page
fastify.get('/documents', async (request, reply) => {
  return reply.view('documents', {
    title: 'Your Documents',
  });
});

// Fallback 404 route
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).view('error', {
    message: 'Page not found',
  });
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    fastify.log.info(`Server running on port ${process.env.PORT || 3000}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
