import Fastify from 'fastify';
import path from 'path';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import handlebars from 'handlebars';

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
