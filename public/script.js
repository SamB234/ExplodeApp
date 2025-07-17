// public/script.js
import { supabase } from '/supabaseClient.js';

const email = document.getElementById('email');
const password = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const logoutBtn = document.getElementById('logoutBtn');
const notes = document.getElementById('notes');

const authSection = document.getElementById('authSection');
const notesSection = document.getElementById('notesSection');

let currentUser = null;

loginBtn?.addEventListener('click', async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  });
  if (error) return alert(error.message);
  currentUser = data.user;
  await loadNotes();
  toggleUI(true);
});

signupBtn?.addEventListener('click', async () => {
  const { data, error } = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
  });
  if (error) return alert(error.message);
  alert("Check your inbox to confirm your email.");
});

logoutBtn?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  toggleUI(false);
});

notes?.addEventListener('input', async () => {
  if (!currentUser) return;
  await supabase.from('notes').upsert({
    user_id: currentUser.id,
    content: notes.value,
  });
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

async function loadNotes() {
  const { data: { user } } = await supabase.auth.getUser();
  currentUser = user;
  if (!user) return toggleUI(false);
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', user.id)
    .single();
  notes.value = data?.content || '';
  toggleUI(true);
}

loadNotes();
