// server.js
const path = require('path');
const fastify = require('fastify')({ logger: true, trustProxy: true });

const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const fastifyCookie = require('@fastify/cookie');
const fastifySession = require('@fastify/session');
const handlebars = require('handlebars');
require('dotenv').config();

// register helper
handlebars.registerHelper('json', (ctx) => JSON.stringify(ctx, null, 2));

// static assets
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
});

// views
fastify.register(fastifyView, {
  engine: { handlebars },
  // <-- point at src/pages
  root: path.join(__dirname, 'src', 'pages'),
  layout: false,
});

// parse form bodies, cookies & sessions
fastify.register(fastifyFormbody);
fastify.register(fastifyCookie);
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || 'a-very-secret-key',
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
  saveUninitialized: false,
});

// simple home route
fastify.get('/', async (req, reply) => {
  return reply.view('index.hbs', {
    title: 'Engineering Notes'
  });
});

// 404 fallback (optional)
fastify.setNotFoundHandler((req, reply) => {
  reply.code(404).send('Page not found');
});

// start
const PORT = process.env.PORT || 3000;
fastify.listen({ port: PORT }, (err) => {
  if (err) throw err;
  fastify.log.info(`Server listening on http://localhost:${PORT}`);
});
