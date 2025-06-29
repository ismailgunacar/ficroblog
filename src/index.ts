import { Hono } from 'hono';
import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import type { User, Post, Follow } from './models';
import { sessionMiddleware, setSessionCookie, clearSessionCookie } from './session';
import { hashPassword, verifyPassword } from './auth';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { promises as fs } from 'node:fs';
import path from 'node:path';

dotenv.config();

const app = new Hono();
app.use(sessionMiddleware);

// Configuration
const DOMAIN = process.env.DOMAIN || 'localhost:3000';

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error('MONGODB_URI is not set in environment variables');
}

const client = new MongoClient(mongoUri);

// --- AttachHandlers global script injection ---
const attachHandlersScript = `
window.attachHandlers = function() {
  const DOMAIN = '${DOMAIN}';
  
  function ensureScriptPresent() {
    // Always ensure the main handler script is present in <head>
    let mainScript = document.getElementById('main-handlers-script');
    if (!mainScript) {
      mainScript = document.createElement('script');
      mainScript.setAttribute('data-main-handlers', 'true');
      mainScript.id = 'main-handlers-script';
      mainScript.type = 'text/javascript';
      mainScript.textContent = window._mainHandlersScriptContent;
      document.head.appendChild(mainScript);
    }
    // Always re-set window._mainHandlersScriptContent from <head> after DOM update
    if (mainScript) {
      window._mainHandlersScriptContent = mainScript.textContent;
    }
    // If window.attachHandlers is not defined, eval the script content to define it
    if (typeof window.attachHandlers !== 'function' && window._mainHandlersScriptContent) {
      try { eval(window._mainHandlersScriptContent); } catch (e) { /* ignore */ }
    }
  }
  function setBodyFromHTML(html) {
    // Robustly extract <body>...</body> content using DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Replace the entire document body
    document.body.innerHTML = doc.body.innerHTML;
    
    // Remove any accidentally injected handler script tags from body
    const scripts = document.body.querySelectorAll('script[data-main-handlers]');
    scripts.forEach(s => s.remove());
    
    // Re-inject the main handlers script into head if it doesn't exist
    let mainScript = document.getElementById('main-handlers-script');
    if (!mainScript && window._mainHandlersScriptContent) {
      mainScript = document.createElement('script');
      mainScript.setAttribute('data-main-handlers', 'true');
      mainScript.id = 'main-handlers-script';
      mainScript.type = 'text/javascript';
      mainScript.textContent = window._mainHandlersScriptContent;
      document.head.appendChild(mainScript);
    }
    
    // Re-attach handlers
    if (typeof window.attachHandlers === 'function') {
      window.attachHandlers();
    } else if (window._mainHandlersScriptContent) {
      try {
        eval(window._mainHandlersScriptContent);
        window.attachHandlers && window.attachHandlers();
      } catch (e) {
        console.error('[setBodyFromHTML] eval error', e);
        window.location.reload();
      }
    }
  }
  function setProfileCardFromHTML(html) {
    // Extract just the profile card article
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const newProfileCard = doc.getElementById('profile-card');
    
    if (newProfileCard) {
      const currentProfileCard = document.getElementById('profile-card');
      if (currentProfileCard) {
        currentProfileCard.outerHTML = newProfileCard.outerHTML;
      }
    }
    
    // Re-attach handlers
    if (typeof window.attachHandlers === 'function') {
      window.attachHandlers();
    } else if (window._mainHandlersScriptContent) {
      try {
        eval(window._mainHandlersScriptContent);
        window.attachHandlers && window.attachHandlers();
      } catch (e) {
        console.error('[setProfileCardFromHTML] eval error', e);
        window.location.reload();
      }
    }
  }
  const loggedIn = !!document.getElementById('logout-btn');
  if (loggedIn) {
    const editBtn = document.getElementById('edit-profile-btn');
    const saveBtn = document.getElementById('save-profile-btn');
    const cancelBtn = document.getElementById('cancel-profile-btn');
    const msg = document.getElementById('profile-msg');
    const fields = [
      ['profile-name', 'edit-name'],
      ['profile-username', 'edit-username'],
      ['profile-bio', 'edit-bio'],
      ['avatar-img', 'edit-avatarUrl'],
      ['header-img', 'edit-headerUrl']
    ];
    if (editBtn && saveBtn) {
      editBtn.onclick = function() {
        const profileInfo = document.querySelector('.profile-info');
        if (profileInfo) profileInfo.classList.add('editing');
        
        fields.forEach(([view, edit]) => {
          const v = document.getElementById(view);
          const e = document.getElementById(edit);
          if (v) v.style.display = 'none';
          if (e) e.style.display = '';
        });
        editBtn.style.display = 'none';
        saveBtn.style.display = '';
        cancelBtn.style.display = '';
      };
      saveBtn.onclick = async function() {
        const name = document.getElementById('edit-name').value;
        const username = document.getElementById('edit-username').value;
        const bio = document.getElementById('edit-bio').value;
        const avatarUrl = document.getElementById('edit-avatarUrl').value;
        const headerUrl = document.getElementById('edit-headerUrl').value;
        const res = await fetch('/profile/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, username, bio, avatarUrl, headerUrl })
        });
        if (res.ok) {
          msg.textContent = 'Saved!';
          setTimeout(() => msg.textContent = '', 2000);
          document.getElementById('profile-name').textContent = name;
          document.getElementById('profile-username').textContent = '@' + username + '@' + DOMAIN;
          document.getElementById('profile-bio').textContent = bio;
          document.getElementById('avatar-img').src = avatarUrl;
          document.getElementById('avatar-img').style.display = avatarUrl ? '' : 'none';
          document.getElementById('header-img').src = headerUrl;
          document.getElementById('header-img').style.display = headerUrl ? '' : 'none';
          fields.forEach(([view, edit]) => {
            const v = document.getElementById(view);
            const e = document.getElementById(edit);
            if (v) v.style.display = '';
            if (e) e.style.display = 'none';
          });
          editBtn.style.display = '';
          saveBtn.style.display = 'none';
          cancelBtn.style.display = 'none';
          
          const profileInfo = document.querySelector('.profile-info');
          if (profileInfo) profileInfo.classList.remove('editing');
        } else {
          msg.textContent = 'Error saving profile.';
          msg.style.color = '#c00';
        }
      };
      cancelBtn.onclick = function() {
        // Revert form fields back to original values
        document.getElementById('edit-name').value = document.getElementById('profile-name').textContent;
        document.getElementById('edit-username').value = document.getElementById('profile-username').textContent.replace('@' + DOMAIN, '').replace('@', '');
        document.getElementById('edit-bio').value = document.getElementById('profile-bio').textContent;
        document.getElementById('edit-avatarUrl').value = document.getElementById('avatar-img').src;
        document.getElementById('edit-headerUrl').value = document.getElementById('header-img').src;
        
        // Switch back to view mode
        fields.forEach(([view, edit]) => {
          const v = document.getElementById(view);
          const e = document.getElementById(edit);
          if (v) v.style.display = '';
          if (e) e.style.display = 'none';
        });
        editBtn.style.display = '';
        saveBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
        msg.textContent = '';
        
        const profileInfo = document.querySelector('.profile-info');
        if (profileInfo) profileInfo.classList.remove('editing');
      };
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = async function(e) {
        e.preventDefault();
        await fetch('/logout', { method: 'POST' });
        const res = await fetch('/', { headers: { 'X-Requested-With': 'fetch', 'Accept': 'application/json' } });
        if (res.ok) {
          const data = await res.json();
          setBodyFromHTML(data.html);
        } else {
          window.location.reload();
        }
      };
    }
  } else {
    const loginToggle = document.getElementById('login-toggle');
    const loginForm = document.getElementById('inline-login');
    const passwordInput = document.getElementById('login-password');
    if (loginToggle && loginForm && passwordInput) {
      loginToggle.onclick = function() {
        if (passwordInput.style.display === 'none' || passwordInput.style.display === '') {
          passwordInput.style.display = 'block';
          passwordInput.focus();
        } else if (passwordInput.value.trim() === '') {
          passwordInput.style.display = 'none';
          passwordInput.value = '';
        } else {
          doLogin();
        }
      };
      passwordInput.onkeydown = function(e) {
        if (e.key === 'Enter') {
          if (passwordInput.value.trim() !== '') {
            doLogin();
          }
        }
      };
      function doLogin() {
        const formData = new FormData(loginForm);
        console.log('Sending login request...');
        fetch('/', {
          method: 'POST',
          headers: { 
            'X-Requested-With': 'fetch',
            'Accept': 'application/json'
          },
          body: formData
        })
        .then(async res => {
          const contentType = res.headers.get('content-type') || '';
          console.log('Login response content-type:', contentType);
          console.log('Login response status:', res.status);
          
          if (contentType.includes('application/json')) {
            const data = await res.json();
            console.log('Login response data:', data);
            if (data.success) {
              console.log('Login successful, updating page');
              setBodyFromHTML(data.html);
            } else {
              console.log('Login failed, updating profile card');
              setProfileCardFromHTML(data.html);
            }
          } else {
            console.log('Non-JSON response, updating entire page');
            const html = await res.text();
            setBodyFromHTML(html);
          }
        })
        .catch(error => {
          console.error('Login error:', error);
          // Fallback to page reload on error
          window.location.reload();
        });
      }
    }
  }
};
`;

// Move renderHome above all usages
function renderHome({
  user,
  postCount,
  followerCount,
  followingCount,
  allPosts,
  userMap,
  loggedIn,
  invalidPassword
}: {
  user: User | null,
  postCount: number,
  followerCount: number,
  followingCount: number,
  allPosts: Post[],
  userMap: Map<string, string>,
  loggedIn: boolean,
  invalidPassword: boolean
}) {
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>
        
        
        ${user ? user.name : 'fongoblog2'}
      </title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <style>
        :root { color-scheme: light; }
        
        /* Simple, wide layout */
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1rem;
        }
        
        /* Minimal profile section */
        #profile-card { 
          margin: 2em 0;
          padding: 1.5em;
          border-radius: 0;
          border: 1px solid var(--muted-border-color);
        }
        
        #header-img { 
          max-width: none;
          width: calc(100% + 3em);
          height: 300px;
          object-fit: cover;
          border-radius: 8px 8px 0px 0px;
          margin: -1.5em -1.5em 2em -1.5em;
          position: relative;
        }
        
        #avatar-img { 
          width: 60px;
          height: 60px;
          border-radius: 50%;
          object-fit: cover;
          margin-right: 1em;
          vertical-align: top;
        }
        
        .profile-info {
          display: inline-block;
          vertical-align: middle;
        }
        
        #profile-name {
          margin: 0 0 0.2em 0;
          font-size: 1.5em;
          font-weight: 700;
        }
        
        #profile-username {
          color: var(--muted-color);
          display: inline;
        }
        
        #profile-bio {
          margin: 0 0 1em 0;
        }
        
        .profile-stats {
          display: inline;
          margin-left: 1em;
          vertical-align: middle;
        }
        
        .stat-item {
          display: inline;
          margin-right: 1em;
        }
        
        .stat-number {
          font-weight: bold;
        }
        
        /* Responsive design for smaller screens */
        @media (max-width: 768px) {
          .profile-stats {
            display: block;
            margin-left: 0;
            margin-top: 0.5em;
          }
          
          .stat-item {
            display: inline-block;
            margin-right: 1em;
          }
        }
        
        .profile-actions {
          margin-top: 1em;
          border-top: 1px solid var(--muted-border-color);
          padding-top: 1em;
          text-align: right;
        }
        
        /* Login form styling to prevent width changes */
        #inline-login {
          display: inline-block;
        }
        
        #inline-login .grid {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        #login-toggle {
          min-width: 100px;
          width: 100px;
          flex-shrink: 0;
        }
        
        #login-password {
          width: 180px;
          flex-shrink: 0;
        }
        
        .timeline-container {
          margin-top: 2em;
        }
        
        .post-form {
          margin-bottom: 2em;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .post-form .grid {
          gap: 1rem;
          display: block;
        }
        
        .post-form input[name="content"] {
          min-height: 80px;
          resize: vertical;
          font-family: inherit;
          line-height: 1.5;
          width: 100%;
          box-sizing: border-box;
        }
        
        .post-form button[type="submit"] {
          align-self: flex-end;
          min-width: 100px;
          margin-top: 1rem;
        }
        
        .timeline-list {
          list-style: none !important;
          padding: 0;
          margin: 0;
        }
        
        .timeline-list li {
          list-style: none !important;
          list-style-type: none !important;
          margin-bottom: 1.5em;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transition: box-shadow 0.2s ease, transform 0.2s ease;
        }
        
        // .timeline-list li:hover {
        //   box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        //   transform: translateY(-2px);
        // }
        
        .timeline-list li header {
          margin-bottom: 0.75em;
          padding-bottom: 0.75em;
          border-bottom: 1px solid var(--muted-border-color);
        }
        
        .post-author {
          font-weight: 600;
          text-decoration: none;
          color: var(--primary-color);
          font-size: 1.1em;
        }
        
        .post-author:hover {
          text-decoration: underline;
        }
        
        .timeline-list li p {
          margin: 0 0 1em 0;
          line-height: 1.6;
          font-size: 1.05em;
        }
        
        .post-meta {
          margin-top: 0.75em;
          font-size: 0.9em;
          color: var(--muted-color);
          display: flex;
          align-items: center;
          gap: 0.5em;
        }
        
        .permalink-link {
          color: var(--muted-color);
          text-decoration: none;
          font-size: 0.9em;
        }
        
        .permalink-link:hover {
          text-decoration: underline;
        }
        
        /* Edit profile form styling */
        #edit-name,
        #edit-username,
        #edit-bio,
        #edit-avatarUrl,
        #edit-headerUrl {
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 0.5em;
          display: block;
        }
        
        #edit-bio {
          min-height: 80px;
          resize: none;
        }
        
        /* When in edit mode, make profile-info full width */
        .profile-info.editing {
          display: block;
          width: 100%;
        }
      </style>
      <script id="main-handlers-script" data-main-handlers="true" type="text/javascript">${attachHandlersScript}</script>
      <script>
        window._mainHandlersScriptContent = document.getElementById('main-handlers-script').textContent;
        // Try to attach handlers immediately
        if (typeof window.attachHandlers === 'function') {
          window.attachHandlers();
        }
        // Also attach when DOM is ready
        document.addEventListener('DOMContentLoaded', function() {
          if (typeof window.attachHandlers === 'function') {
            window.attachHandlers();
          } else if (window._mainHandlersScriptContent) {
            try {
              eval(window._mainHandlersScriptContent);
              window.attachHandlers && window.attachHandlers();
            } catch (e) {
              console.error('Error attaching handlers:', e);
            }
          }
        });
      </script>
    </head>
    <body class="container">
      <article id="profile-card" class="card">
        <img id="header-img" src="${user?.headerUrl || ''}" alt="header" style="object-fit:cover;${user?.headerUrl ? '' : 'display:none;'}" />
        <input id="edit-headerUrl" name="headerUrl" value="${user?.headerUrl || ''}" placeholder="Header Image URL" style="display:none;width:100%;" class="input" />
        <img id="avatar-img" src="${user?.avatarUrl || ''}" alt="avatar" style="width:60px;height:60px;border-radius:50%;object-fit:cover;${user?.avatarUrl ? '' : 'display:none;'}" />
        <input id="edit-avatarUrl" name="avatarUrl" value="${user?.avatarUrl || ''}" placeholder="Avatar URL" style="display:none;" class="input" />
        <div class="profile-info">
          <h1 id="profile-name">${user?.name || 'fongoblog2'}</h1>
          <input id="edit-name" name="name" value="${user?.name || ''}" style="display:none;" class="input" />
          <p id="profile-username">@${user?.username || ''}@${DOMAIN}</p>
          <input id="edit-username" name="username" value="${user?.username || ''}" style="display:none;" class="input" />
          <div class="profile-stats">
            <div class="stat-item">
              <span class="stat-number" id="stat-posts">${postCount}</span> Posts
            </div>
            <div class="stat-item">
              <span class="stat-number" id="stat-followers">${followerCount}</span> Followers
            </div>
            <div class="stat-item">
              <span class="stat-number" id="stat-following">${followingCount}</span> Following
            </div>
          </div>
          <p id="profile-bio">${user?.bio || ''}</p>
          <textarea id="edit-bio" name="bio" style="display:none;width:100%;" class="input">${user?.bio || ''}</textarea>
        </div>
        <div class="profile-actions">
          ${loggedIn ? `
            <button id="edit-profile-btn" class="secondary">Edit</button>
            <button id="save-profile-btn" style="display:none;" class="contrast">Save</button>
            <button id="cancel-profile-btn" style="display:none;" class="outline">Cancel</button>
            <button id="logout-btn" type="button" class="outline">Logout</button>
            <div id="profile-msg" style="margin-top:1em;color:#090;"></div>
          ` : `
            <form method="post" action="/" id="inline-login" style="display:inline-block;">
              <div class="grid">
                <button type="button" id="login-toggle" class="primary">Login</button>
                <input name="password" id="login-password" type="password" placeholder="Password" required class="input" style="width:180px;display:none;" autocomplete="current-password" />
              </div>
              ${invalidPassword ? '<small class="secondary" style="color:var(--del-color);display:block;margin-top:6px;">Invalid password</small>' : ''}
            </form>
          `}
        </div>
      </article>
      ${loggedIn ? `
      <form method="post" action="/" class="post-form">
        <input name="content" placeholder="What's on your mind?" required class="input" />
        <button type="submit" class="primary">Post</button>
      </form>
      ` : ''}
      <div class="timeline-container">
        <ul class="timeline-list">
          ${allPosts.map(post => `
            <li class="card">
              <header>
                <a href="/user/${userMap.get(post.userId.toString()) ?? 'unknown'}" class="post-author">@${userMap.get(post.userId.toString()) ?? 'unknown'}</a>
              </header>
              <p>${post.content}</p>
              <footer class="post-meta">
                <small>${post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ''}</small>
                <a href="/post/${post._id}" class="permalink-link">🔗 Permalink</a>
              </footer>
            </li>
          `).join('')}
        </ul>
      </div>
    </body>
    </html>
  `;
}

// Render user profile page
function renderUserProfile({
  profileUser,
  currentUser,
  userPosts,
  userMap,
  loggedIn,
  isOwnProfile,
  isFollowing,
  postCount,
  followerCount,
  followingCount
}: {
  profileUser: User,
  currentUser: User | null,
  userPosts: Post[],
  userMap: Map<string, string>,
  loggedIn: boolean,
  isOwnProfile: boolean,
  isFollowing: boolean,
  postCount: number,
  followerCount: number,
  followingCount: number
}) {
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>@${profileUser.username}@${DOMAIN} - fongoblog2</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <style>
        :root { color-scheme: light; }
        
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1rem;
        }
        
        #profile-card { 
          margin: 2em 0;
          padding: 1.5em;
          border-radius: 0;
          border: 1px solid var(--muted-border-color);
        }
        
        #header-img { 
          max-width: none;
          width: calc(100% + 3em);
          height: 300px;
          object-fit: cover;
          border-radius: 8px 8px 0px 0px;
          margin: -1.5em -1.5em 2em -1.5em;
          position: relative;
        }
        
        #avatar-img { 
          width: 60px;
          height: 60px;
          border-radius: 50%;
          object-fit: cover;
          margin-right: 1em;
          vertical-align: top;
        }
        
        .profile-info {
          display: inline-block;
          vertical-align: middle;
        }
        
        #profile-name {
          margin: 0 0 0.2em 0;
          font-size: 1.5em;
          font-weight: 700;
        }
        
        #profile-username {
          margin: 0 0 0.5em 0;
          color: var(--muted-color);
          display: inline-block;
        }
        
        #profile-bio {
          margin: 0 0 1em 0;
        }
        
        .profile-stats {
          display: inline;
          margin-left: 1em;
          vertical-align: middle;
        }
        
        .stat-item {
          display: inline-block;
          margin-right: 1em;
        }
        
        .stat-number {
          font-weight: bold;
        }
        
        /* Responsive design for smaller screens */
        @media (max-width: 768px) {
          .profile-stats {
            display: block;
            margin-left: 0;
            margin-top: 0.5em;
          }
          
          .stat-item {
            display: inline-block;
            margin-right: 1em;
          }
        }
        
        .profile-actions {
          margin-top: 1em;
          border-top: 1px solid var(--muted-border-color);
          padding-top: 1em;
          text-align: right;
        }
        
        .timeline-container {
          margin-top: 2em;
        }
        
        .post-form {
          margin-bottom: 2em;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .post-form .grid {
          gap: 1rem;
          display: block;
        }
        
        .post-form input[name="content"] {
          min-height: 80px;
          resize: vertical;
          font-family: inherit;
          line-height: 1.5;
          width: 100%;
          box-sizing: border-box;
        }
        
        .post-form button[type="submit"] {
          align-self: flex-end;
          min-width: 100px;
          margin-top: 1rem;
        }
        
        .timeline-list {
          list-style: none !important;
          padding: 0;
          margin: 0;
        }
        
        .timeline-list li {
          list-style: none !important;
          list-style-type: none !important;
          margin-bottom: 1.5em;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transition: box-shadow 0.2s ease, transform 0.2s ease;
        }
        
        .timeline-list li:hover {
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }
        
        .timeline-list li header {
          margin-bottom: 0.75em;
          padding-bottom: 0.75em;
          border-bottom: 1px solid var(--muted-border-color);
        }
        
        .post-author {
          font-weight: 600;
          text-decoration: none;
          color: var(--primary-color);
          font-size: 1.1em;
        }
        
        .post-author:hover {
          text-decoration: underline;
        }
        
        .timeline-list li p {
          margin: 0 0 1em 0;
          line-height: 1.6;
          font-size: 1.05em;
        }
        
        .post-meta {
          margin-top: 0.75em;
          font-size: 0.9em;
          color: var(--muted-color);
          display: flex;
          align-items: center;
          gap: 0.5em;
        }
        
        .back-link {
          margin-bottom: 1em;
        }
        
        /* Edit profile form styling */
        #edit-name,
        #edit-username,
        #edit-bio,
        #edit-avatarUrl,
        #edit-headerUrl {
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 0.5em;
          display: block;
        }
        
        #edit-bio {
          min-height: 80px;
          resize: none;
        }
        
        /* When in edit mode, make profile-info full width */
        .profile-info.editing {
          display: block;
          width: 100%;
        }
      </style>
      <script>
        async function toggleFollow() {
          const button = document.getElementById('follow-btn');
          const response = await fetch('/user/${profileUser.username}/follow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await response.json();
          
          if (data.success) {
            if (data.following) {
              button.textContent = 'Unfollow';
              button.className = 'outline';
            } else {
              button.textContent = 'Follow';
              button.className = 'primary';
            }
          }
        }
      </script>
    </head>
    <body class="container">
      <div class="back-link">
        <a href="/" class="secondary">← Back to Timeline</a>
      </div>
      
      <article id="profile-card" class="card">
        <img id="header-img" src="${profileUser.headerUrl || ''}" alt="header" style="object-fit:cover;${profileUser.headerUrl ? '' : 'display:none;'}" />
        <img id="avatar-img" src="${profileUser.avatarUrl || ''}" alt="avatar" style="width:60px;height:60px;border-radius:50%;object-fit:cover;${profileUser.avatarUrl ? '' : 'display:none;'}" />
        <div class="profile-info">
          <h1 id="profile-name">${profileUser.name}</h1>
          <p id="profile-username">@${profileUser.username}@${DOMAIN}</p>
          <div class="profile-stats">
            <div class="stat-item">
              <span class="stat-number">${postCount}</span> Posts
            </div>
            <div class="stat-item">
              <span class="stat-number">${followerCount}</span> Followers
            </div>
            <div class="stat-item">
              <span class="stat-number">${followingCount}</span> Following
            </div>
          </div>
          <p id="profile-bio">${profileUser.bio || ''}</p>
        </div>
      </article>
      
      <!-- Removed posting card from user profile page -->
      <!-- ${isOwnProfile && loggedIn ? `
      <form method="post" action="/" class="post-form">
        <input name="content" placeholder="What's on your mind?" required class="input" />
        <button type="submit" class="primary">Post</button>
      </form>
      ` : ''} -->
      
      <div class="timeline-container">
        <ul class="timeline-list">
          ${userPosts.map(post => `
            <li class="card">
              <header>
                <a href="/user/${userMap.get(post.userId.toString()) ?? 'unknown'}" class="post-author">@${userMap.get(post.userId.toString()) ?? 'unknown'}</a>
              </header>
              <p>${post.content}</p>
              <footer class="post-meta">
                <small>${post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ''}</small>
                <a href="/post/${post._id}" class="permalink-link">🔗 Permalink</a>
              </footer>
            </li>
          `).join('')}
        </ul>
        ${userPosts.length === 0 ? '<p>No posts yet.</p>' : ''}
      </div>
    </body>
    </html>
  `;
}

// Render individual post permalink page
function renderPostPermalink({
  post,
  postAuthor,
  currentUser,
  userMap,
  loggedIn,
  postCount,
  followerCount,
  followingCount
}: {
  post: Post,
  postAuthor: User,
  currentUser: User | null,
  userMap: Map<string, string>,
  loggedIn: boolean,
  postCount: number,
  followerCount: number,
  followingCount: number
}) {
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>@${postAuthor.username}@${DOMAIN} - fongoblog2</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <style>
        :root { color-scheme: light; }
        
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1rem;
        }
        
        #profile-card { 
          margin: 2em 0;
          padding: 1.5em;
          border-radius: 0;
          border: 1px solid var(--muted-border-color);
        }
        
        #header-img { 
          max-width: none;
          width: calc(100% + 3em);
          height: 300px;
          object-fit: cover;
          border-radius: 8px 8px 0px 0px;
          margin: -1.5em -1.5em 2em -1.5em;
          position: relative;
        }
        
        #avatar-img { 
          width: 60px;
          height: 60px;
          border-radius: 50%;
          object-fit: cover;
          margin-right: 1em;
          vertical-align: top;
        }
        
        .profile-info {
          display: inline-block;
          vertical-align: middle;
        }
        
        #profile-name {
          margin: 0 0 0.2em 0;
          font-size: 1.5em;
          font-weight: 700;
        }
        
        #profile-username {
          margin: 0 0 0.5em 0;
          color: var(--muted-color);
          display: inline-block;
        }
        
        #profile-bio {
          margin: 0 0 1em 0;
        }
        
        .profile-stats {
          display: inline;
          margin-left: 1em;
          vertical-align: middle;
        }
        
        .stat-item {
          display: inline-block;
          margin-right: 1em;
        }
        
        .stat-number {
          font-weight: bold;
        }
        
        /* Responsive design for smaller screens */
        @media (max-width: 768px) {
          .profile-stats {
            display: block;
            margin-left: 0;
            margin-top: 0.5em;
          }
          
          .stat-item {
            display: inline-block;
            margin-right: 1em;
          }
        }
        
        .profile-actions {
          margin-top: 1em;
          border-top: 1px solid var(--muted-border-color);
          padding-top: 1em;
          text-align: right;
        }
        
        .timeline-container {
          margin-top: 2em;
        }
        
        .timeline-list {
          list-style: none !important;
          padding: 0;
          margin: 0;
        }
        
        .timeline-list li {
          list-style: none !important;
          list-style-type: none !important;
          margin-bottom: 1.5em;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transition: box-shadow 0.2s ease, transform 0.2s ease;
        }
        
        .timeline-list li:hover {
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }
        
        .timeline-list li header {
          margin-bottom: 0.75em;
          padding-bottom: 0.75em;
          border-bottom: 1px solid var(--muted-border-color);
        }
        
        .post-author {
          font-weight: 600;
          text-decoration: none;
          color: var(--primary-color);
          font-size: 1.1em;
        }
        
        .post-author:hover {
          text-decoration: underline;
        }
        
        .timeline-list li p {
          margin: 0 0 1em 0;
          line-height: 1.6;
          font-size: 1.05em;
        }
        
        .post-meta {
          margin-top: 0.75em;
          font-size: 0.9em;
          color: var(--muted-color);
          display: flex;
          align-items: center;
          gap: 0.5em;
        }
        
        .back-link {
          margin-bottom: 1em;
        }
        
        .permalink-link {
          color: var(--muted-color);
          text-decoration: none;
          font-size: 0.9em;
        }
        
        .permalink-link:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body class="container">
      <div class="back-link">
        <a href="/" class="secondary">← Back to Timeline</a>
      </div>
      
      <article id="profile-card" class="card">
        <img id="header-img" src="${postAuthor.headerUrl || ''}" alt="header" style="object-fit:cover;${postAuthor.headerUrl ? '' : 'display:none;'}" />
        <img id="avatar-img" src="${postAuthor.avatarUrl || ''}" alt="avatar" style="width:60px;height:60px;border-radius:50%;object-fit:cover;${postAuthor.avatarUrl ? '' : 'display:none;'}" />
        <div class="profile-info">
          <h1 id="profile-name">${postAuthor.name}</h1>
          <p id="profile-username">@${postAuthor.username}@${DOMAIN}</p>
          <div class="profile-stats">
            <div class="stat-item">
              <span class="stat-number">${postCount}</span> Posts
            </div>
            <div class="stat-item">
              <span class="stat-number">${followerCount}</span> Followers
            </div>
            <div class="stat-item">
              <span class="stat-number">${followingCount}</span> Following
            </div>
          </div>
          <p id="profile-bio">${postAuthor.bio || ''}</p>
        </div>
      </article>
      
      <div class="timeline-container">
        <ul class="timeline-list">
          <li class="card">
            <header>
              <a href="/user/${userMap.get(post.userId.toString()) ?? 'unknown'}" class="post-author">@${userMap.get(post.userId.toString()) ?? 'unknown'}</a>
            </header>
            <p>${post.content}</p>
            <footer class="post-meta">
              <small>${post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ''}</small>
              <a href="/post/${post._id}" class="permalink-link">🔗 Permalink</a>
            </footer>
          </li>
        </ul>
      </div>
    </body>
    </html>
  `;
}

// User profile page (/user/username) - FIRST ROUTE to ensure it's matched
app.get('/user/:username', async (c) => {
  console.log('=== PROFILE ROUTE HIT ===');
  console.log('Path:', c.req.path);
  console.log('URL:', c.req.url);
  console.log('Method:', c.req.method);
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  const follows = db.collection<Follow>('follows');
  
  // Check if any users exist, if not redirect to setup
  const anyUser = await users.findOne({});
  if (!anyUser) return c.redirect('/setup');
  
  const username = c.req.param('username');
  console.log('Looking for username:', username);
  const profileUser = await users.findOne({ username });
  
  if (!profileUser) {
    console.log('User not found:', username);
    return c.html('<h1>User not found</h1>', 404);
  }
  
  console.log('Found user:', profileUser.username);
  
  // Get user's posts
  const userPosts = await posts.find({ userId: profileUser._id }).sort({ createdAt: -1 }).limit(20).toArray();
  
  // Check if current user is logged in
  const session = getCookie(c, 'session');
  let loggedIn = false;
  let currentUser: User | null = null;
  let isOwnProfile = false;
  let isFollowing = false;
  
  if (session && session.length === 24 && /^[a-fA-F0-9]+$/.test(session)) {
    currentUser = await users.findOne({ _id: new ObjectId(session) });
    if (currentUser) {
      loggedIn = true;
      isOwnProfile = currentUser._id?.toString() === profileUser._id?.toString();
      
      // Check if following
      if (!isOwnProfile) {
        const follow = await follows.findOne({ 
          followerId: currentUser._id?.toString(), 
          followingId: profileUser._id?.toString() 
        });
        isFollowing = !!follow;
      }
    }
  }
  
  // Stats
  let postCount = 0;
  let followerCount = 0;
  let followingCount = 0;
  if (profileUser._id) {
    postCount = await posts.countDocuments({ userId: profileUser._id.toString() });
    followerCount = await follows.countDocuments({ followingId: profileUser._id.toString() });
    followingCount = await follows.countDocuments({ followerId: profileUser._id.toString() });
  }
  
  // Create userMap for posts
  const userMap = new Map<string, string>();
  userMap.set(profileUser._id?.toString() || '', profileUser.username);
  
  console.log('Rendering profile page for:', username);
  return c.html(renderUserProfile({ 
    profileUser, 
    currentUser, 
    userPosts, 
    userMap, 
    loggedIn, 
    isOwnProfile, 
    isFollowing, 
    postCount, 
    followerCount, 
    followingCount 
  }));
});

// @username route (redirects to /user/username)
app.get('/@:username', async (c) => {
  const username = c.req.param('username');
  return c.redirect(`/user/${username}`);
});

// Individual post permalink route
app.get('/post/:postId', async (c) => {
  console.log('=== POST PERMALINK ROUTE HIT ===');
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  const follows = db.collection<Follow>('follows');
  
  // Check if any users exist, if not redirect to setup
  const anyUser = await users.findOne({});
  if (!anyUser) return c.redirect('/setup');
  
  const postId = c.req.param('postId');
  console.log('Looking for post ID:', postId);
  
  let post: Post | null = null;
  try {
    post = await posts.findOne({ _id: new ObjectId(postId) });
  } catch (e) {
    console.log('Invalid post ID format');
    return c.html('<h1>Post not found</h1>', 404);
  }
  
  if (!post) {
    console.log('Post not found:', postId);
    return c.html('<h1>Post not found</h1>', 404);
  }
  
  console.log('Found post:', post._id);
  
  // Get the author of the post
  const postAuthor = await users.findOne({ _id: new ObjectId(post.userId.toString()) });
  if (!postAuthor) {
    return c.html('<h1>Post author not found</h1>', 404);
  }
  
  // Check if current user is logged in
  const session = getCookie(c, 'session');
  let loggedIn = false;
  let currentUser: User | null = null;
  
  if (session && session.length === 24 && /^[a-fA-F0-9]+$/.test(session)) {
    currentUser = await users.findOne({ _id: new ObjectId(session) });
    if (currentUser) {
      loggedIn = true;
    }
  }
  
  // Create userMap for the single post
  const userMap = new Map<string, string>();
  userMap.set(post.userId.toString(), postAuthor.username);
  
  // Stats for the author
  const postCount = await posts.countDocuments({ userId: postAuthor._id });
  const followerCount = await follows.countDocuments({ followingId: postAuthor._id?.toString() });
  const followingCount = await follows.countDocuments({ followerId: postAuthor._id?.toString() });
  
  console.log('Rendering post permalink page for:', postId);
  return c.html(renderPostPermalink({ 
    post, 
    postAuthor, 
    currentUser, 
    userMap, 
    loggedIn, 
    postCount, 
    followerCount, 
    followingCount 
  }));
});

// Setup page (only if no user exists)
app.get('/setup', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const user = await users.findOne({});
  if (user) return c.redirect('/');
  return c.html(`
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Setup fongoblog2</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <style>
        :root { color-scheme: light; }
        
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 2rem 1rem;
        }
        
        .setup-card {
          margin: 2em 0;
          padding: 2em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .setup-header {
          text-align: center;
          margin-bottom: 2em;
        }
        
        .setup-header h1 {
          margin: 0 0 0.5em 0;
          font-size: 2.5em;
          font-weight: 700;
          color: var(--primary-color);
        }
        
        .setup-header p {
          margin: 0;
          color: var(--muted-color);
          font-size: 1.1em;
        }
        
        .setup-form {
          margin-top: 2em;
        }
        
        .setup-form .grid {
          gap: 1rem;
        }
        
        .setup-form input {
          width: 100%;
          box-sizing: border-box;
        }
        
        .setup-form button {
          width: 100%;
          margin-top: 1rem;
          font-size: 1.1em;
          padding: 0.75em;
        }
        
        .welcome-message {
          background: var(--primary-color);
          color: white;
          padding: 1em;
          border-radius: 8px;
          margin-bottom: 2em;
          text-align: center;
        }
      </style>
    </head>
    <body class="container">
      <div class="setup-card">
        <div class="setup-header">
          <h1>Welcome to fongoblog2</h1>
          <p>This is (supposed to be) a federated single-user microblog on MongoDB Atlas. Let's get you set up.</p>
        </div>
        
        
        <form method="post" action="/setup" class="setup-form">
          
          <div>
            <label for="username">Username@${DOMAIN}</label>
            <input name="username" id="username" placeholder="Enter your username" required />
          </div>
          <div>
            <label for="name">Display Name</label>
            <input name="name" id="name" placeholder="Enter your display name" required />
          </div>
          
          <div>
            <label for="password">Password</label>
            <input name="password" id="password" type="password" placeholder="Choose a secure password" required />
          </div>
          <button type="submit" class="primary">Create Account</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/setup', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const user = await users.findOne({});
  if (user) return c.redirect('/');
  const body = await c.req.parseBody();
  const username = typeof body['username'] === 'string' ? body['username'] : '';
  const name = typeof body['name'] === 'string' ? body['name'] : '';
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  if (!username || !name || !password) return c.text('All fields required', 400);
  const passwordHash = await hashPassword(password);
  const newUser: User = { username, name, passwordHash, createdAt: new Date() };
  const result = await users.insertOne(newUser);
  setCookie(c, 'session', result.insertedId.toString(), { httpOnly: true, path: '/' });
  return c.redirect('/');
});

// Minimal homepage: show timeline and post form
app.get('/', async (c) => {
  await client.connect();
  const db = client.db();
  const posts = db.collection<Post>('posts');
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  // Check if any users exist, if not redirect to setup
  const anyUser = await users.findOne({});
  if (!anyUser) return c.redirect('/setup');
  
  const allPosts = await posts.find({}).sort({ createdAt: -1 }).limit(20).toArray();
  // Fetch usernames for posts
  const userMap = new Map<string, string>();
  for (const post of allPosts) {
    const userIdStr = post.userId.toString();
    if (post.userId && !userMap.has(userIdStr)) {
      let username = 'unknown';
      try {
        // Handle both ObjectId and string types
        const userId = typeof post.userId === 'string' ? new ObjectId(post.userId) : post.userId;
        const user = await users.findOne({ _id: userId });
        if (user) username = user.username;
      } catch (e) {
        // ignore invalid ObjectId
      }
      userMap.set(userIdStr, username);
    }
  }
  // Check session via cookie
  const session = getCookie(c, 'session');
  let loggedIn = false;
  let user: User | null = null;
  if (session && session.length === 24 && /^[a-fA-F0-9]+$/.test(session)) {
    user = await users.findOne({ _id: new ObjectId(session) });
    if (user) loggedIn = true;
  } else {
    user = await users.findOne({}); // fallback for stats if not logged in
  }
  // Stats
  let postCount = 0;
  let followerCount = 0;
  let followingCount = 0;
  if (user && user._id) {
    postCount = await posts.countDocuments({ userId: user._id.toString() });
    followerCount = await follows.countDocuments({ followingId: user._id.toString() });
    followingCount = await follows.countDocuments({ followerId: user._id.toString() });
  }
  // Detect if JSON is expected
  const wantsJson = c.req.header('x-requested-with') === 'fetch' || c.req.header('accept')?.includes('application/json') || c.req.header('content-type')?.includes('application/json');
  const html = renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn, invalidPassword: false });
  if (wantsJson) {
    return c.json({ html });
  }
  return c.html(html);
});

// In the root POST handler, pass invalidPassword: true if login failed
app.post('/', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  const follows = db.collection<Follow>('follows');
  const user = await users.findOne({});
  if (!user) return c.redirect('/setup');
  const body = await c.req.parseBody();
  // If password is present, treat as login attempt
  if (typeof body['password'] === 'string') {
    const password = body['password'];
    const valid = await verifyPassword(password, user.passwordHash);
    // Fetch posts and stats as in GET '/'
    const allPosts = await posts.find({}).sort({ createdAt: -1 }).limit(20).toArray();
    const userMap = new Map<string, string>();
    for (const post of allPosts) {
      const userIdStr = post.userId.toString();
      if (post.userId && !userMap.has(userIdStr)) {
        let username = 'unknown';
        try {
          // Handle both ObjectId and string types
          const userId = typeof post.userId === 'string' ? new ObjectId(post.userId) : post.userId;
          const u = await users.findOne({ _id: userId });
          if (u) username = u.username;
        } catch (e) {}
        userMap.set(userIdStr, username);
      }
    }
    // Stats for profile card
    let postCount = 0;
    let followerCount = 0;
    let followingCount = 0;
    if (user._id) {
      postCount = await posts.countDocuments({ userId: user._id.toString() });
      followerCount = await follows.countDocuments({ followingId: user._id.toString() });
      followingCount = await follows.countDocuments({ followerId: user._id.toString() });
    }
    // Detect if JSON is expected
    const wantsJson = c.req.header('x-requested-with') === 'fetch' || 
                     c.req.header('accept')?.includes('application/json') || 
                     c.req.header('content-type')?.includes('application/json') ||
                     c.req.header('x-requested-with') === 'XMLHttpRequest';
    
    console.log('Login request headers:', {
      'x-requested-with': c.req.header('x-requested-with'),
      'accept': c.req.header('accept'),
      'content-type': c.req.header('content-type'),
      wantsJson
    });
    
    if (!valid) {
      if (wantsJson) {
        console.log('Login failed, returning JSON response');
        return c.json({ success: false, html: renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: false, invalidPassword: true }) });
      }
      console.log('Login failed, returning HTML response');
      return c.html(renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: false, invalidPassword: true }));
    }
    if (user._id) {
      setSessionCookie(c, user._id.toString());
    }
    if (wantsJson) {
      console.log('Login successful, returning JSON response');
      return c.json({ success: true, html: renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: true, invalidPassword: false }) });
    }
    console.log('Login successful, redirecting');
    return c.redirect('/');
  }
  // If content is present, treat as post form (only for logged-in user)
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) return c.redirect('/');
  const loggedInUser = await users.findOne({ _id: new ObjectId(session) });
  if (!loggedInUser) return c.redirect('/');
  const content = typeof body['content'] === 'string' ? body['content'] : '';
  if (!content) return c.redirect('/');
  const result = await posts.insertOne({ userId: loggedInUser._id, content, createdAt: new Date() });
  return c.redirect('/');
});

// Profile editing (AJAX)
app.post('/profile/edit', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const body = await c.req.json();
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) return c.json({ success: false });
  const user = await users.findOne({ _id: new ObjectId(session) });
  if (!user) return c.json({ success: false });
  const updates: Partial<User> = {};
  if (typeof body.name === 'string') updates.name = body.name;
  if (typeof body.username === 'string') updates.username = body.username;
  if (typeof body.bio === 'string') updates.bio = body.bio;
  if (typeof body.avatarUrl === 'string') updates.avatarUrl = body.avatarUrl;
  if (typeof body.headerUrl === 'string') updates.headerUrl = body.headerUrl;
  await users.updateOne({ _id: user._id }, { $set: updates });
  return c.json({ success: true });
});

// Follow/Unfollow user
app.post('/user/:username/follow', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.json({ success: false, error: 'Not logged in' });
  }
  
  const currentUser = await users.findOne({ _id: new ObjectId(session) });
  if (!currentUser) {
    return c.json({ success: false, error: 'User not found' });
  }
  
  const username = c.req.param('username');
  const profileUser = await users.findOne({ username });
  if (!profileUser) {
    return c.json({ success: false, error: 'Profile user not found' });
  }
  
  if (currentUser._id?.toString() === profileUser._id?.toString()) {
    return c.json({ success: false, error: 'Cannot follow yourself' });
  }
  
  const existingFollow = await follows.findOne({ 
    followerId: currentUser._id?.toString(), 
    followingId: profileUser._id?.toString() 
  });
  
  if (existingFollow) {
    // Unfollow
    await follows.deleteOne({ _id: existingFollow._id });
    return c.json({ success: true, following: false });
  }
  
  // Follow
  await follows.insertOne({
    followerId: currentUser._id?.toString() || '',
    followingId: profileUser._id?.toString() || '',
    createdAt: new Date()
  });
  return c.json({ success: true, following: true });
});

// Debug route to list all users
app.get('/debug/users', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const allUsers = await users.find({}, { projection: { username: 1, name: 1, _id: 0 } }).toArray();
  return c.json({ users: allUsers });
});

// Logout handler
app.post('/logout', async (c) => {
  clearSessionCookie(c);
  return c.json({ success: true });
});

// --- Federation Endpoints ---

// WebFinger endpoint
app.get('/.well-known/webfinger', async (c) => {
  const resource = c.req.query('resource');
  if (!resource || !resource.startsWith('acct:')) {
    return c.json({ error: 'Invalid resource' }, 400);
  }
  
  const username = resource.replace('acct:', '').split('@')[0];
  const domain = resource.replace('acct:', '').split('@')[1];
  
  if (domain !== DOMAIN) {
    return c.json({ error: 'Domain mismatch' }, 400);
  }
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const user = await users.findOne({ username });
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  return c.json({
    subject: resource,
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: `https://${DOMAIN}/users/${username}`
      }
    ]
  });
});

// NodeInfo endpoint
app.get('/.well-known/nodeinfo', async (c) => {
  return c.json({
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `https://${DOMAIN}/.well-known/nodeinfo/2.0`
      }
    ]
  });
});

// NodeInfo 2.0 schema
app.get('/.well-known/nodeinfo/2.0', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  
  const userCount = await users.countDocuments({});
  const postCount = await posts.countDocuments({});
  
  return c.json({
    version: '2.0',
    software: {
      name: 'fongoblog2',
      version: '1.0.0'
    },
    protocols: ['activitypub'],
    services: {
      inbound: [],
      outbound: []
    },
    openRegistrations: false,
    usage: {
      users: {
        total: userCount
      },
      localPosts: postCount
    },
    metadata: {
      nodeName: 'fongoblog2',
      nodeDescription: 'A federated social media platform'
    }
  });
});

// ActivityPub Actor endpoint
app.get('/users/:username', async (c) => {
  const username = c.req.param('username');
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  const follows = db.collection<Follow>('follows');
  
  const user = await users.findOne({ username });
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  const postCount = await posts.countDocuments({ userId: user._id });
  const followerCount = await follows.countDocuments({ followingId: user._id?.toString() });
  const followingCount = await follows.countDocuments({ followerId: user._id?.toString() });
  
  const actor = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    id: `https://${DOMAIN}/users/${username}`,
    type: 'Person',
    preferredUsername: username,
    name: user.name,
    summary: user.bio || '',
    url: `https://${DOMAIN}/@${username}`,
    icon: user.avatarUrl ? {
      type: 'Image',
      url: user.avatarUrl
    } : undefined,
    image: user.headerUrl ? {
      type: 'Image',
      url: user.headerUrl
    } : undefined,
    inbox: `https://${DOMAIN}/users/${username}/inbox`,
    outbox: `https://${DOMAIN}/users/${username}/outbox`,
    followers: `https://${DOMAIN}/users/${username}/followers`,
    following: `https://${DOMAIN}/users/${username}/following`,
    publicKey: {
      id: `https://${DOMAIN}/users/${username}#main-key`,
      owner: `https://${DOMAIN}/users/${username}`,
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----\n'
    },
    endpoints: {
      sharedInbox: `https://${DOMAIN}/inbox`
    },
    attachment: [
      {
        type: 'PropertyValue',
        name: 'Posts',
        value: postCount.toString()
      },
      {
        type: 'PropertyValue',
        name: 'Followers',
        value: followerCount.toString()
      },
      {
        type: 'PropertyValue',
        name: 'Following',
        value: followingCount.toString()
      }
    ]
  };
  
  return c.json(actor);
});

// --- Static file serving (for images, etc.) ---
app.get('/public/*', async (c) => {
  // Get the requested file path
  const reqPath = c.req.path.replace(/^\/public/, '');
  const filePath = path.join(process.cwd(), 'public', reqPath);
  try {
    const data = await fs.readFile(filePath);
    // Infer content type from extension
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.html': 'text/html',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': contentType } });
  } catch (err) {
    return c.text('File not found', 404);
  }
});

// --- 404 handler ---
app.notFound((c) => {
  return c.html('<h1>404 - Not Found</h1>');
});

// --- Error handler ---
app.onError((err, c) => {
  console.error('Error:', err);
  return c.text('Internal Server Error', 500);
});

// --- Start the server ---
serve({ fetch: app.fetch, port: 3000 });
