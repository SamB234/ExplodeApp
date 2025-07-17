const path = require('path');
const fastify = require('fastify')({ logger: true, trustProxy: true });

const fastifyStatic = require('@fastify/static');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const fastifyCookie = require('@fastify/cookie');
const fastifySession = require('@fastify/session');
const handlebars = require('handlebars');
const fetch = require('node-fetch');
require('dotenv').config();

// Register plugins
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
});

fastify.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, 'views'),
});

fastify.register(fastifyFormbody);
fastify.register(fastifyCookie);
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || 'a-very-secret-key',
  cookie: {
   // secure: true,
    secure: process.env.NODE_ENV === 'production', // true for HTTPS only
    httpOnly: true,
    sameSite: 'lax',
    },  //false 10.07.25
  
  saveUninitialized: false,

});

// Routes
fastify.get('/', async (req, reply) => {
  return reply.view('index.hbs', { title: 'Engineering Notes' });
});

// Start the server
fastify.listen({ port: process.env.PORT || 3000 }, err => {
  if (err) throw err;
  console.log(`Server is running on port ${process.env.PORT || 3000}`);
});
