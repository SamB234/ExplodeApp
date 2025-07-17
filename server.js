// server.js (CommonJS version)
const path = require('path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const view = require('@fastify/view');
const handlebars = require('handlebars');

const __dirname = path.resolve();
const fastify = Fastify({ logger: true });

fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
});

fastify.register(view, {
  engine: { handlebars },
  root: path.join(__dirname, 'views'),
});

fastify.get('/', async (req, reply) => {
  return reply.view('index.hbs', { title: 'Engineering Notes' });
});

fastify.listen({ port: process.env.PORT || 3000 }, err => {
  if (err) throw err;
});
