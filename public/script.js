// public/script.js

// Using the correct import path for supabaseClient.js from public directory
import { supabase } from '/public/supabaseClient.js';


const email = document.getElementById('email');
const password = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const logoutBtn = document.getElementById('logoutBtn');
// IMPORTANT: Changed from 'notes' to 'noteContent' to match the updated index.hbs
const noteContentInput = document.getElementById('noteContent');

const authSection = document.getElementById('authSection');
const notesSection = document.getElementById('notesSection');

// Get references to the new buttons
const createNewNoteBtn = document.getElementById('createNewNoteBtn');
const viewAllNotesBtn = document.getElementById('viewAllNotesBtn');


let currentUser = null;

// Login using your own backend
loginBtn?.addEventListener('click', async () => {
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'credentials': 'include' }, // Ensure credentials: 'include'
      body: JSON.stringify({ email: email.value, password: password.value }),
    });
    const result = await res.json();
    if (!res.ok) return alert(result.error || 'Login failed');
    currentUser = result.user;
    await loadNotes(); // Load the existing note after login
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
      headers: { 'Content-Type': 'application/json', 'credentials': 'include' }, // Ensure credentials: 'include'
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
    await fetch('/logout', { method: 'POST', credentials: 'include' }); // Ensure credentials: 'include'
  } catch {}
  currentUser = null;
  toggleUI(false);
  noteContentInput.value = ''; // Clear the current note input
});

// Save notes on input (still assuming Supabase backend or your own API)
noteContentInput?.addEventListener('input', async () => {
  if (!currentUser) return; // Only save if a user is logged in
  try {
    await fetch('/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'credentials': 'include' }, // Ensure credentials: 'include'
      body: JSON.stringify({ content: noteContentInput.value }),
    });
  } catch (err) {
    console.error('Failed to save notes', err);
  }
});


// Event Listener for "Create New Note" button
createNewNoteBtn?.addEventListener('click', () => {
  // Clear the current note input area
  if (noteContentInput) {
    noteContentInput.value = '';
    noteContentInput.focus(); // Put cursor there
    // Optionally, display a message to the user that they can start typing a new note
    // For example: alert('Start typing your new note!');
  }
});

// Event Listener for "View All Notes" button
viewAllNotesBtn?.addEventListener('click', () => {
  // Redirect to the /documents page
  window.location.href = '/documents';
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
// This function will load the *single* current note for the main page,
// not all notes, as /notes only returns one.
async function loadNotes() {
  try {
    const res = await fetch('/currentUser', { credentials: 'include' }); // Ensure credentials: 'include'
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
    // Fetch the *current* note for the main textarea
    const notesRes = await fetch('/notes', { credentials: 'include' }); // Ensure credentials: 'include'
    if (!notesRes.ok) {
      noteContentInput.value = ''; // Clear if no note found
      toggleUI(true);
      return;
    }
    const notesData = await notesRes.json();
    noteContentInput.value = notesData.content || ''; // Populate the textarea
    toggleUI(true);
  } catch (err) {
    console.error("Error loading current note:", err);
    toggleUI(false); // If anything fails, revert to logged out state
  }
}

// Initialize UI based on session status when the page loads
loadNotes();
