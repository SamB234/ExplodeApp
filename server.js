const path = require('path');
const fastify = require('fastify')({ logger: true, trustProxy: true });

const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const fastifyCookie = require('@fastify/cookie');
const fastifySession = require('@fastify/session');
const handlebars = require('handlebars');
require('dotenv').config();

// Setup view engine and static files
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
});

fastify.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, 'src/pages'), // <- Update this to match your actual folder
});

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

// Routes
fastify.get('/', async (req, reply) => {
  return reply.view('index.hbs', { title: 'Engineering Notes' });
});

// Start server
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
