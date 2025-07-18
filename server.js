//Gemini Code 17/07/25 17:25

const path = require('path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifySession = require('@fastify/session');
const fastifyCookie = require('@fastify/cookie');
const fastifyFormbody = require('@fastify/formbody');
const fastifyView = require('@fastify/view');
const handlebars = require('handlebars');
const fetch = require('node-fetch'); // Ensure node-fetch v2.x is used if you are using 'require'
const { createClient } = require('@supabase/supabase-js');

// Load environment variables. IMPORTANT: This must be at the very top.
require('dotenv').config();

// Validate essential environment variables immediately
if (!process.env.SUPABASE_URL) {
  console.error('FATAL ERROR: SUPABASE_URL environment variable is not set.');
  process.exit(1);
}
if (!process.env.SUPABASE_KEY) {
  console.error('FATAL ERROR: SUPABASE_KEY environment variable is not set.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('FATAL ERROR: SESSION_SECRET environment variable is not set or is too short (should be at least 32 characters).');
  process.exit(1);
}
if (!process.env.ONSHAPE_CLIENT_ID) {
    console.error('FATAL ERROR: ONSHAPE_CLIENT_ID environment variable is not set.');
    process.exit(1);
}
if (!process.env.ONSHAPE_CLIENT_SECRET) {
    console.error('FATAL ERROR: ONSHAPE_CLIENT_SECRET environment variable is not set.');
    process.exit(1);
}
if (!process.env.ONSHAPE_REDIRECT_URI) {
    console.error('FATAL ERROR: ONSHAPE_REDIRECT_URI environment variable is not set.');
    process.exit(1);
}


const fastify = Fastify({ logger: true, trustProxy: true });

// --- Supabase Client Initialization ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY // Use the service role key on the server
);

// --- Onshape API Constants ---
const ONSHAPE_AUTH_URL = 'https://oauth.onshape.com/oauth/authorize';
const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ONSHAPE_API_BASE_URL = 'https://cad.onshape.com/api/v6';

// --- Handlebars Helper (for JSON formatting in templates) ---
handlebars.registerHelper('json', function (context) {
  return JSON.stringify(context, null, 2);
});

// --- Fastify Plugin Registrations ---

// 1. Cookie Plugin
fastify.register(fastifyCookie);

// 2. Session Plugin
fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET, // Using the validated secret from env
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true for HTTPS only in production
    httpOnly: true, // Prevents client-side JS from accessing the session cookie
    sameSite: 'none', // Recommended for security against CSRF - was 'lax'
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days, adjust as needed
  },
  saveUninitialized: false, // Only create sessions for authenticated users
});

// 3. Static File Server (for assets like index.html, JS, CSS)
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/', // Serves files from /public directly under the root URL (e.g., /index.html)
});

// 4. Form Body Parser (for parsing application/x-www-form-urlencoded and JSON)
// By default, fastify-formbody parses URL-encoded, but Fastify itself handles JSON.
fastify.register(fastifyFormbody);

// 5. View Engine (Handlebars for server-side templating)
fastify.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, 'src/pages'), // Assuming your .hbs template files are in 'src/pages'
  layout: false, // No default layout, specific layouts can be defined per template
});

// --- Fastify Hooks ---

// Set Security Headers for Onshape Integrated App embedding
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('Content-Security-Policy', [
    "default-src 'self';",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;", // Re-evaluate 'unsafe-inline' later if possible
    "style-src 'self' 'unsafe-inline';", // Re-evaluate 'unsafe-inline' later if possible
    "img-src 'self' data:;",
    // IMPORTANT: Add your Supabase project URL here for API calls
    "connect-src 'self' https://cad.onshape.com https://api.onshape.com https://fktxolwcqbwovlbfxevx.supabase.co https://fktxolwcqbwovlbfxevx.functions.supabase.co;",
    // This allows Onshape to embed your app. Your side of the CSP is okay here.
    "frame-ancestors 'self' https://cad.onshape.com https://*.onshape.com;",
  ].join(' '));
  return payload;
});

// --- Helper Functions ---

/**
 * Middleware to ensure a valid Onshape access token is available.
 * Refreshes the token if it's expired or near expiration.
 * Redirects to OAuth start if no valid token is found for Onshape-dependent routes.
 */
async function ensureValidOnshapeToken(request, reply, done) {
  const session = request.session;

  // Check if this route explicitly requires an Onshape token
  const requiresOnshapeToken = request.url.startsWith('/api/') || request.url.startsWith('/listDocuments');

  // If there's no session or no Onshape access token/expiry,
  // and the route requires an Onshape token, redirect to OAuth.
  if (!session || !session.access_token || !session.expires_at) {
    if (requiresOnshapeToken) {
      fastify.log.warn('No Onshape token found for a protected route, redirecting to /oauthStart.');
      return reply.redirect('/oauthStart');
    }
    return done(); // For routes that don't need Onshape token, proceed
  }

  const now = Date.now();
  // Refresh token if it expires within the next 60 seconds
  if (now > session.expires_at - 60000) {
    fastify.log.info('Onshape token near expiration, attempting refresh...');
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
        const errorText = await res.text();
        fastify.log.error(`Failed to refresh Onshape token: ${res.status} - ${errorText}`);
        if (requiresOnshapeToken) {
          // If refresh fails, force re-authorization
          return reply.redirect('/oauthStart');
        }
        return done(); // For non-Onshape routes, proceed even if refresh fails
      }

      const data = await res.json();
      session.access_token = data.access_token;
      session.refresh_token = data.refresh_token || session.refresh_token; // Refresh token might not always be returned
      session.expires_at = Date.now() + data.expires_in * 1000; // Update expiration time
      await session.save();
      fastify.log.info('Onshape token refreshed successfully.');
    } catch (err) {
      fastify.log.error('Error refreshing Onshape token:', err);
      if (requiresOnshapeToken) {
        return reply.redirect('/oauthStart');
      }
      return done(); // For non-Onshape routes
    }
  }
  done(); // Token is valid or refreshed, proceed
}

/**
 * Extracts Onshape document context parameters from query string.
 */
function extractDocumentParams(query) {
  return {
    documentId: query.d || query.documentId,
    workspaceId: query.w || query.workspaceId,
    elementId: query.e || query.elementId,
  };
}

// --- Supabase Authentication & Notes Routes ---

// POST /login - Authenticate user with Supabase (server-side call)
fastify.post('/login', async (req, reply) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return reply.code(400).send({ error: 'Email and password are required.' });
  }

  fastify.log.info(`Attempting Supabase login for: ${email}`);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    fastify.log.error('Supabase login failed:', error.message);
    return reply.code(401).send({ error: error.message, details: error.message });
  }

  // Save Supabase user session info
  req.session.user = {
    id: data.user.id,
    email: data.user.email,
    supabase_access_token: data.session.access_token, // This is the Supabase token, distinct from Onshape
  };
  fastify.log.info(`User ${data.user.email} (Supabase ID: ${data.user.id}) logged in via Supabase.`);
  return reply.send({ message: 'Login successful', userId: data.user.id });
});

// POST /signup - Register new user with Supabase (server-side call)
// Added a signup route as it's common for auth
fastify.post('/signup', async (req, reply) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return reply.code(400).send({ error: 'Email and password are required.' });
  }

  fastify.log.info(`Attempting Supabase signup for: ${email}`);
  // For signup, we also call it server-side.
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    fastify.log.error('Supabase signup failed:', error.message);
    return reply.code(400).send({ error: error.message, details: error.message });
  }

  // Handle email verification flow if enabled in Supabase
  if (data.user && !data.user.confirmed_at) {
    fastify.log.info(`Signup successful for ${email}. Email verification required.`);
    return reply.send({ message: 'Signup successful! Please check your email to verify your account.' });
  }

  // If no email verification needed (e.g., auto-confirm) or already confirmed
  req.session.user = {
    id: data.user.id,
    email: data.user.email,
    supabase_access_token: data.session.access_token,
  };
  fastify.log.info(`User ${data.user.email} (Supabase ID: ${data.user.id}) signed up and logged in via Supabase.`);
  return reply.send({ message: 'Signup successful!', userId: data.user.id });
});


// POST /logout - Log out user from Supabase session
fastify.post('/logout', async (req, reply) => {
  // Clear only the Supabase user info from session
  req.session.user = null;
  // If you want to also clear the Onshape session, add:
  // req.session.access_token = null;
  // req.session.refresh_token = null;
  // req.session.expires_at = null;

  // It's good practice to also sign out from Supabase if the token is known/used client-side
  // const { error } = await supabase.auth.signOut();
  // if (error) fastify.log.error('Supabase logout error:', error.message);

  fastify.log.info('Supabase user session cleared.');
  return reply.send({ message: 'Logged out successfully.' });
});






// server.js

// --- GET /documents Route ---
// Fetches all notes for the user and prepares them for display on the documents list page.
fastify.get('/documents', async (request, reply) => {
    if (!request.session.user) {
        return reply.redirect('/login'); // Redirect to login if not authenticated
    }

    const userId = request.session.user.id;
    fastify.log.info(`Attempting to retrieve all notes for Supabase user_id: ${userId} for documents page.`);

    try {
        const { data: allNotes, error: findError } = await supabase
            .from('notes')
            // IMPORTANT: Select 'id', 'title', 'content', 'updated_at', and 'is_active'
            .select('id, title, content, updated_at, is_active')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false }); // Order by most recently updated

        if (findError) {
            // Log the actual Supabase error for better debugging
            fastify.log.error('Error retrieving all notes for documents page:', findError.message);
            return reply.status(500).send({ error: 'Failed to retrieve notes list.' });
        }

        fastify.log.info(`Notes retrieved for Supabase user ${userId}. Count: ${allNotes ? allNotes.length : 0}`);

        // Process notes data for rendering in the Handlebars template
        const notesForDisplay = allNotes.map(note => ({
            id: note.id,
            // Use 'title' from DB, or a default if empty/null
            title: (note.title && note.title.trim() !== '') ? note.title : `Untitled Note ${note.id.substring(0, 8)}`,
            // Create a preview from 'content', truncate if too long
            preview: note.content ? note.content.substring(0, 100) + (note.content.length > 100 ? '...' : '') : '(Empty Note)',
            // Format updated_at date nicely; handle cases where updated_at might be null/empty
            updatedAt: note.updated_at ? new Date(note.updated_at).toLocaleString() : 'Never updated',
            isActive: note.is_active // Pass active status to the template
        }));

        // Render the documents page with the notes data
        return reply.view('documents', { // Assuming 'documents' is the correct view name (e.g., documents.hbs)
            userName: request.session.user.email, // Or request.session.user.name if available
            notes: notesForDisplay
        });

    } catch (e) {
        fastify.log.error('Exception in GET /documents:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
});



// --- DELETE /notes Route ---
// Handles deletion of one or more notes based on provided IDs.
fastify.delete('/notes', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;
    const { noteIds } = request.body; // Expect an array of note IDs from the frontend

    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
        return reply.status(400).send({ error: 'No note IDs provided for deletion.' });
    }

    try {
        // IMPORTANT SECURITY STEP: Verify that all provided noteIds belong to the current user.
        const { data: userOwnedNotes, error: fetchError } = await supabase
            .from('notes')
            .select('id')
            .in('id', noteIds) // Select only the IDs that match the provided list
            .eq('user_id', userId); // And belong to the current user

        if (fetchError) {
            fastify.log.error('Error verifying note ownership for deletion:', fetchError.message);
            return reply.status(500).send({ error: 'Failed to verify note ownership.' });
        }

        const ownedNoteIds = userOwnedNotes.map(note => note.id);
        const unownedNoteIds = noteIds.filter(id => !ownedNoteIds.includes(id));

        if (unownedNoteIds.length > 0) {
            fastify.log.warn(`User ${userId} attempted to delete unowned notes: ${unownedNoteIds.join(', ')}. Only owned notes will be deleted.`);
        }

        // Proceed only with notes that are actually owned by the user
        const notesToDelete = ownedNoteIds;

        if (notesToDelete.length === 0) {
             return reply.status(400).send({ error: 'No valid notes to delete or all selected notes are unowned.' });
        }

        // Before deleting, check if the currently active note was among those to be deleted.
        // If it is, clear the activeNoteId in the session and deactivate any active notes in DB.
        if (request.session.activeNoteId && notesToDelete.includes(request.session.activeNoteId)) {
            request.session.activeNoteId = null; // Clear active note in session
            fastify.log.info(`Active note ${request.session.activeNoteId} was among deleted notes. Clearing session activeNoteId.`);
            
            // Explicitly deactivate any notes that might still be marked as active for this user
            const { error: deactivateError } = await supabase
                .from('notes')
                .update({ is_active: false })
                .eq('user_id', userId)
                .eq('is_active', true);
            if (deactivateError) {
                fastify.log.warn('Could not deactivate active notes during deletion cleanup:', deactivateError.message);
            }
        }


        // Perform the deletion for owned notes
        const { error: deleteError } = await supabase
            .from('notes')
            .delete()
            .in('id', notesToDelete)
            .eq('user_id', userId); // Extra security filter on delete

        if (deleteError) {
            fastify.log.error('Error deleting notes from Supabase:', deleteError.message);
            return reply.status(500).send({ error: 'Failed to delete notes.' });
        }

        fastify.log.info(`User ${userId} successfully deleted notes: ${notesToDelete.join(', ')}`);
        return reply.status(200).send({ message: 'Notes deleted successfully.', deletedCount: notesToDelete.length });

    } catch (e) {
        fastify.log.error('Exception in DELETE /notes:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
});



// --- POST /notes Route (UPDATE existing note content and title) ---
// This route is primarily for saving changes to an *existing* note.
// It will update the active note based on session.activeNoteId.
fastify.post('/notes', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;
    const { content, title } = request.body; // Expect both content and title from the frontend

    fastify.log.info(`DEBUG POST /notes (Save/Update): User ${userId}, Content length: ${content ? content.length : 0}, Title: "${title ? title : 'null/undefined'}"`);

    // Basic validation for content (can be empty string, but not undefined/null)
    if (content === undefined || content === null) {
        return reply.status(400).send({ error: 'Note content is required.' });
    }

    // Ensure title is a string; default to empty if not provided/valid
    const noteTitle = (typeof title === 'string' && title.trim() !== '') ? title.trim() : '';

    try {
        // Determine the note ID to update. Prioritize session.activeNoteId.
        let noteIdToUpdate = request.session.activeNoteId;

        // If no active note is explicitly set in session, try to find the one marked as active in DB
        if (!noteIdToUpdate) {
            const { data: activeNotesFromDb, error: findActiveError } = await supabase
                .from('notes')
                .select('id')
                .eq('user_id', userId)
                .eq('is_active', true)
                .limit(1);

            if (findActiveError) {
                fastify.log.error('Error finding active note from DB for update:', findActiveError.message);
                return reply.status(500).send({ error: 'Failed to find active note for update.' });
            }

            if (activeNotesFromDb && activeNotesFromDb.length > 0) {
                noteIdToUpdate = activeNotesFromDb[0].id;
                request.session.activeNoteId = noteIdToUpdate; // Set in session for future use
            }
        }

        if (noteIdToUpdate) {
            // Update the existing active note
            const { data, error: updateError } = await supabase
                .from('notes')
                .update({ content: content, title: noteTitle, updated_at: new Date().toISOString() }) // Also update title and timestamp
                .eq('id', noteIdToUpdate)
                .eq('user_id', userId); // Security: Ensure the user owns this note

            if (updateError) {
                fastify.log.error(`Error updating note ID ${noteIdToUpdate}:`, updateError.message);
                return reply.status(500).send({ error: 'Failed to update note.' });
            }
            fastify.log.info(`Updated note (ID: ${noteIdToUpdate}) for user ${userId}.`);
            return reply.status(200).send({ message: 'Note updated successfully.', noteId: noteIdToUpdate });

        } else {
            // Fallback: If no active note exists at all for the user, create a new one.
            // This case should ideally be rare if /notes/new or /GET notes (fallback) is used correctly.
            fastify.log.info(`No active note found for user ${userId} to update. Creating a new one as fallback.`);

            // Ensure no other notes are active for this user before inserting a new active one
            await supabase.from('notes').update({ is_active: false }).eq('user_id', userId).eq('is_active', true);

            const { data: newNote, error: insertError } = await supabase
                .from('notes')
                .insert({ user_id: userId, content: content, title: noteTitle, is_active: true })
                .select('*')
                .single();

            if (insertError) {
                fastify.log.error('Error inserting new note (fallback from update):', insertError.message);
                return reply.status(500).send({ error: 'Failed to save new note.' });
            }
            request.session.activeNoteId = newNote.id; // Set new note as active
            fastify.log.info(`Created new note (ID: ${newNote.id}) as active for user ${userId} (fallback from update).`);
            return reply.status(201).send({ message: 'New note created successfully.', noteId: newNote.id, note: newNote });
        }

    } catch (e) {
        fastify.log.error('Exception in POST /notes:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
});



// --- GET /notes Route (LOAD active or specific note) ---
// This route is for loading a single note for editing.
// It can either load a specific note by ID or the user's currently active note.
fastify.get('/notes', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;
    const noteIdFromQuery = request.query.id; // Note ID from URL query parameter

    try {
        let targetNoteData = null;

        if (noteIdFromQuery) {
            // Case 1: A specific note ID is provided in the query string
            fastify.log.info(`Attempting to load specific note ID from query: ${noteIdFromQuery} for user ${userId}`);

            // Verify ownership and existence of the requested note
            const { data: requestedNote, error: checkError } = await supabase
                .from('notes')
                .select('*') // Select all columns to return the full note
                .eq('id', noteIdFromQuery)
                .eq('user_id', userId)
                .single();

            if (checkError || !requestedNote) {
                fastify.log.warn(`Note ${noteIdFromQuery} not found or not owned by user ${userId}:`, checkError ? checkError.message : 'Not Found');
                // If not found or not owned, fallback to default behavior (active note or create new)
                // Do NOT return here. Continue to find active note or create new.
            } else {
                targetNoteData = requestedNote;
                // Deactivate any currently active notes for this user
                await supabase
                    .from('notes')
                    .update({ is_active: false })
                    .eq('user_id', userId)
                    .eq('is_active', true); // Only deactivate notes that are currently active

                // Set the requested note as the new active note
                const { error: activateError } = await supabase
                    .from('notes')
                    .update({ is_active: true })
                    .eq('id', targetNoteData.id)
                    .eq('user_id', userId); // Security check

                if (activateError) {
                    fastify.log.error(`Error activating note ${targetNoteData.id}:`, activateError.message);
                } else {
                     fastify.log.info(`Activated note ${targetNoteData.id} for user ${userId}.`);
                }
                request.session.activeNoteId = targetNoteData.id; // Update session
                return reply.status(200).send(targetNoteData); // Return the full data of the activated note
            }
        }

        // Case 2: No specific note ID in query, or provided ID was invalid/unowned.
        // Try to load the note currently marked as active for the user.
        if (!targetNoteData) { // Only proceed if a note hasn't been found/activated yet
            fastify.log.info(`Attempting to fetch current active note for user ${userId}.`);
            const { data: activeNotes, error: findActiveError } = await supabase
                .from('notes')
                .select('*') // Select all columns for the active note
                .eq('user_id', userId)
                .eq('is_active', true)
                .limit(1); // Only one active note expected

            if (findActiveError) {
                fastify.log.error('Error finding active note for user:', findActiveError.message);
                return reply.status(500).send({ error: 'Failed to retrieve active note.' });
            }

            if (activeNotes && activeNotes.length > 0) {
                targetNoteData = activeNotes[0];
                request.session.activeNoteId = targetNoteData.id; // Ensure session is updated
                fastify.log.info(`Active note (ID: ${targetNoteData.id}) found for user ${userId}.`);
                return reply.status(200).send(targetNoteData);
            }
        }

        // Case 3: No active note found at all (neither specific nor existing active).
        // Create a brand new, empty one and set it as active.
        if (!targetNoteData) {
            fastify.log.info(`No active note found for user ${userId}. Creating a new default note.`);

            // Ensure no other notes are active before inserting a new one
            await supabase.from('notes').update({ is_active: false }).eq('user_id', userId).eq('is_active', true);

            const { data: newNote, error: insertError } = await supabase
                .from('notes')
                .insert({ user_id: userId, content: '', title: 'New Note', is_active: true }) // Default title and empty content
                .select('*') // Get the newly created note's data
                .single();

            if (insertError) {
                fastify.log.error('Error creating default new note:', insertError.message);
                return reply.status(500).send({ error: 'Failed to create default new note.' });
            }

            request.session.activeNoteId = newNote.id; // Set new note as active in session
            fastify.log.info(`Created new default active note (ID: ${newNote.id}) for user ${userId}.`);
            return reply.status(200).send(newNote); // Return the newly created empty note
        }

    } catch (e) {
        fastify.log.error('Exception in GET /notes:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
});



// --- POST /notes/new Route (CREATE a brand new empty note and make it active) ---
// This route specifically handles the request to create a *new, empty* note.
fastify.post('/notes/new', async (request, reply) => {
    if (!request.session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = request.session.user.id;
    fastify.log.info(`Received request to create new note for user ${userId}.`);

    try {
        // Step 1: Deactivate the current active note for this user
        const { error: deactivateError } = await supabase
            .from('notes')
            .update({ is_active: false })
            .eq('user_id', userId)
            .eq('is_active', true);

        if (deactivateError) {
            fastify.log.warn('Could not deactivate old active note (might not exist):', deactivateError.message);
        } else {
            fastify.log.info(`Deactivated previous active note for user ${userId}.`);
        }

        // Step 2: Insert a brand new note with default empty content and title, and set it as active
        const { data: newNote, error: insertError } = await supabase
            .from('notes')
            .insert({ user_id: userId, content: '', title: 'New Note', is_active: true }) // Initialize with empty content and default title
            .select('*') // Get the newly created row data
            .single(); // Expecting one newly inserted row

        if (insertError) {
            fastify.log.error('Error inserting new active note:', insertError.message); // Log the actual error message
            return reply.status(500).send({ error: 'Failed to create new note.' });
        }

        const newNoteId = newNote.id;
        request.session.activeNoteId = newNoteId; // Set new note as active in session
        fastify.log.info(`Created new active note (ID: ${newNoteId}) for user ${userId}.`);
        
        // Return the new note data so the frontend can update its state if needed
        // Or redirect to the main page which will load this new active note.
        return reply.status(201).send({ message: 'New note created successfully.', note: newNote });

    } catch (e) {
        fastify.log.error('Exception in POST /notes/new:', e);
        return reply.status(500).send({ error: 'Internal server error.' });
    }
});






// --- Onshape Integrated App Routes ---

// GET / - Root route, handles both initial app load and Onshape context
fastify.get('/', async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  let onshapeAccessToken = request.session.access_token;

  // Handle case where Onshape might pass accessToken in query params for integrated apps
  if (!onshapeAccessToken && request.query.accessToken) {
    onshapeAccessToken = request.query.accessToken;
    request.session.access_token = onshapeAccessToken;
    // For integrated apps, the OAuth flow might be simpler or managed by Onshape.
    // If no explicit `expires_in` is provided by Onshape in query, set a heuristic.
    // The `ensureValidOnshapeToken` preHandler will handle refreshing.
    request.session.expires_at = Date.now() + (3600 * 1000); // Assume 1 hour validity for query-param token initially
    await request.session.save();
    fastify.log.info('Onshape access token received from query parameters and saved to session.');
  }

  // Check if an Onshape access token is available in the session
  if (!onshapeAccessToken) {
    fastify.log.info('No Onshape access token found in session or query, rendering initial page.');
    return reply.view('index.hbs', {
      title: 'Integrated Onshape & Supabase App',
      message: 'Welcome! Please authorize Onshape or login for notes.',
      oauthUrl: '/oauthStart',
      showOnshapeAuth: true, // Flag to control visibility of Onshape auth button in your template
      showSupabaseAuth: true, // Flag to control visibility of Supabase auth form
    });
  }

  fastify.log.info('Onshape access token found, rendering assembly view.');
  // If we have an Onshape token, render the assembly view
  return reply.view('assembly_view.hbs', {
    title: 'Onshape Exploded View',
    documentId,
    workspaceId,
    elementId,
    accessToken: onshapeAccessToken, // Pass to client-side for potential direct API calls or debugging
  });
});

// Onshape API Routes - Protected by ensureValidOnshapeToken
fastify.get('/api/assemblydata', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching assembly data for D:${documentId}, W:${workspaceId}, E:${elementId}`);

  if (!documentId || !workspaceId || !elementId) {
    return reply.status(400).send('Missing document context parameters (documentId, workspaceId, elementId).');
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
      fastify.log.error(`Onshape API error fetching assembly definition (${res.status}): ${errorText}`);
      return reply.status(res.status).send(`Error fetching assembly definition: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/assemblydata:', err);
    return reply.status(500).send('Internal Server Error fetching assembly data.');
  }
});

fastify.get('/api/gltf-model', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching GLTF model for D:${documentId}, W:${workspaceId}, E:${elementId}`);

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
      fastify.log.error(`GLTF fetch failed (${res.status}): ${errorText}`);
      return reply.status(res.status).send(`Error fetching GLTF: ${errorText}`);
    }

    reply.header('Content-Type', 'model/gltf+json');
    return reply.send(res.body);
  } catch (err) {
    fastify.log.error('Error in /api/gltf-model:', err);
    return reply.status(500).send('Internal Server Error fetching GLTF model.');
  }
});

fastify.get('/api/exploded-config', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching exploded config for D:${documentId}, W:${workspaceId}, E:${elementId}`);

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
      fastify.log.error(`Exploded config error (${res.status}): ${errorText}`);
      return reply.status(res.status).send(`Error fetching exploded config: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/exploded-config:', err);
    return reply.status(500).send('Internal Server Error fetching exploded config.');
  }
});

fastify.get('/api/mates', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  const { documentId, workspaceId, elementId } = extractDocumentParams(request.query);
  fastify.log.info(`Fetching mates for D:${documentId}, W:${workspaceId}, E:${elementId}`);

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
      fastify.log.error(`Mate fetch error (${res.status}): ${errorText}`);
      return reply.status(res.status).send(`Error fetching mates: ${errorText}`);
    }

    const data = await res.json();
    return reply.send(data);
  } catch (err) {
    fastify.log.error('Error in /api/mates:', err);
    return reply.status(500).send('Internal Server Error fetching mates.');
  }
});

// Onshape OAuth Start
fastify.get('/oauthStart', async (request, reply) => {
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const redirectUri = process.env.ONSHAPE_REDIRECT_URI;
  const scope = 'OAuth2ReadPII OAuth2Read OAuth2Write'; // Adjust scope as needed
  const state = 'state123'; // In production, generate a cryptographically secure random state and verify it

  fastify.log.info(`Initiating Onshape OAuth flow with Redirect URI: ${redirectUri}`);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state,
  });

  return reply.redirect(`${ONSHAPE_AUTH_URL}?${params.toString()}`);
});

// Onshape OAuth Redirect Callback
fastify.get('/oauthRedirect', async (request, reply) => {
  const { code, state, error, error_description } = request.query;

  if (error) {
    fastify.log.error(`Onshape OAuth error during redirect: ${error_description || error}`);
    return reply.status(400).send(`Onshape OAuth Error: ${error_description || error}`);
  }

  if (!code) {
    return reply.status(400).send('Missing authorization code from Onshape.');
  }

  // In production, verify the 'state' parameter here to prevent CSRF attacks.
  // if (state !== 'expected_state_from_session') {
  //   return reply.status(400).send('Invalid state parameter.');
  // }

  fastify.log.info('Onshape OAuth redirect received, exchanging code for token...');

  try {
    const res = await fetch(ONSHAPE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${process.env.ONSHAPE_CLIENT_ID}:${process.env.ONSHAPE_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.ONSHAPE_REDIRECT_URI,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      fastify.log.error('Onshape token exchange failed:', res.status, data);
      return reply.status(res.status).send(`Onshape token exchange failed: ${data.error_description || JSON.stringify(data)}`);
    }

    const data = await res.json();

    request.session.access_token = data.access_token;
    request.session.refresh_token = data.refresh_token;
    request.session.expires_at = Date.now() + data.expires_in * 1000; // Convert seconds to milliseconds
    await request.session.save(); // Persist session changes

    fastify.log.info('Onshape access token and refresh token saved to session.');

    // Redirect to the root of your application, which will now have the token
    return reply.redirect('/');
  } catch (err) {
    fastify.log.error('Onshape OAuth redirect server error:', err);
    return reply.status(500).send('Onshape token exchange failed due to server error.');
  }
});

// GET /listDocuments - List Onshape documents for the authenticated user
fastify.get('/listDocuments', { preHandler: ensureValidOnshapeToken }, async (request, reply) => {
  fastify.log.info('Listing Onshape documents.');

  try {
    const res = await fetch(`${ONSHAPE_API_BASE_URL}/documents`, {
      headers: {
        Authorization: `Bearer ${request.session.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const error = await res.json();
      fastify.log.error('Error fetching Onshape documents:', error);
      return reply.status(res.status).send(`Failed to fetch Onshape documents: ${error.message || JSON.stringify(error)}`);
    }

    const documents = await res.json();
    return reply.view('documents.hbs', { documents }); // Render documents using a Handlebars template
  } catch (err) {
    fastify.log.error('Server error while fetching Onshape documents:', err);
    return reply.status(500).send('Server error while fetching Onshape documents.');
  }
});










// GET /currentUser - Get current Supabase user from session
fastify.get('/currentUser', async (req, reply) => {
    if (req.session.user && req.session.user.id) {
        fastify.log.info(`Returning current user: ${req.session.user.email}`);
        return reply.send({ user: { id: req.session.user.id, email: req.session.user.email } });
    } else {
        fastify.log.info('No current Supabase user in session.');
        return reply.code(401).send({ user: null, message: 'No user logged in.' });
    }
});

// --- Server Start ---
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log(`Server running on port ${fastify.server.address().port}`);
    fastify.log.info('Fastify server started successfully.');
    if (process.env.NODE_ENV !== 'production') {
        fastify.log.warn('Running in development mode. Ensure NODE_ENV=production for secure cookies in production.');
    }
  } catch (err) {
    fastify.log.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
