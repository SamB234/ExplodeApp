// public/script.js
//import { supabase } from '/supabaseClient.js';
import { supabase } from '/public/supabaseClient.js';


// public/script.js

const email = document.getElementById('email');
const password = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const logoutBtn = document.getElementById('logoutBtn');
const notes = document.getElementById('notes');

const authSection = document.getElementById('authSection');
const notesSection = document.getElementById('notesSection');

let currentUser = null;

// Login using your own backend
loginBtn?.addEventListener('click', async () => {
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value }),
    });
    const result = await res.json();
    if (!res.ok) return alert(result.error || 'Login failed');
    currentUser = result.user;
    await loadNotes();
    toggleUI(true);
  } catch (err) {
    alert('Login request failed');
  }
});

// Signup using your own backend
signupBtn?.addEventListener('click', async () => {
  try {
    const res = await fetch('/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value }),
    });
    const result = await res.json();
    if (!res.ok) return alert(result.error || 'Signup failed');
    alert(result.message || 'Check your inbox to confirm your email.');
  } catch (err) {
    alert('Signup request failed');
  }
});

// Logout (assuming your server handles session cookies)
logoutBtn?.addEventListener('click', async () => {
  try {
    await fetch('/logout', { method: 'POST' }); // optional logout endpoint on your server
  } catch {}
  currentUser = null;
  toggleUI(false);
  notes.value = '';
});

// Save notes on input (still assuming Supabase backend or your own API)
notes?.addEventListener('input', async () => {
  if (!currentUser) return;
  try {
    await fetch('/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: notes.value }),
    });
  } catch (err) {
    console.error('Failed to save notes', err);
  }
});

function toggleUI(loggedIn) {
  if (loggedIn) {
    authSection.classList.add('hidden');
    notesSection.classList.remove('hidden');
  } else {
    authSection.classList.remove('hidden');
    notesSection.classList.add('hidden');
  }
}

// Load notes for the logged-in user
async function loadNotes() {
  try {
    const res = await fetch('/user');
    if (!res.ok) {
      toggleUI(false);
      return;
    }
    const userData = await res.json();
    currentUser = userData.user;
    if (!currentUser) {
      toggleUI(false);
      return;
    }
    const notesRes = await fetch('/notes');
    if (!notesRes.ok) {
      notes.value = '';
      toggleUI(true);
      return;
    }
    const notesData = await notesRes.json();
    notes.value = notesData.content || '';
    toggleUI(true);
  } catch (err) {
    toggleUI(false);
  }
}

// Initialize UI based on session
loadNotes();
