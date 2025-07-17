const path = require('path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifySession = require('@fastify/session');
const fastifyCookie = require('@fastify/cookie');
const { createClient } = require('@supabase/supabase-js');

const fastify = Fastify({ logger: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // use the service role key on the server
);

// Middleware: cookies + session
fastify.register(fastifyCookie);
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || 'a-secret-that-should-be-long',
  cookie: { secure: false }, // set to true in production with HTTPS
});

// Serve static files from /public
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

// --- Auth routes ---
fastify.post('/login', async (req, reply) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return reply.code(401).send({ error: error.message });
  }

  // Save user session info
  req.session.user = {
    id: data.user.id,
    email: data.user.email,
    access_token: data.session.access_token,
  };

  return reply.send({ message: 'Login successful' });
});

fastify.post('/logout', async (req, reply) => {
  req.session.user = null;
  return reply.send({ message: 'Logged out' });
});

// --- Notes routes ---

// GET /notes – retrieve notes for logged in user
fastify.get('/notes', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ error: 'Not logged in' });
  }

  const { id: user_id } = req.session.user;

  const { data, error } = await supabase
    .from('notes')
    .select('content')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    return reply.code(500).send({ error: error.message });
  }

  return reply.send({ content: data[0]?.content || '' });
});

// POST /notes – save a note for the logged in user
fastify.post('/notes', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ error: 'Not logged in' });
  }

  const { id: user_id } = req.session.user;
  const { content } = req.body;

  const { error } = await supabase
    .from('notes')
    .insert([{ user_id, content }]);

  if (error) {
    return reply.code(500).send({ error: error.message });
  }

  return reply.send({ message: 'Note saved' });
});

// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log(`Server running on port ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
