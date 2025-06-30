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
import { mountFedifyRoutes } from './fedify';
import { 
  createFollow, 
  removeFollow, 
  isFollowing, 
  getFollowers, 
  getFollowing,
  markPostAsFederated,
  getFederationStats,
  getFederatedPosts,
  getRecentFederationActivity
} from './federation-utils';
import { generateRSAKeyPair } from './keys';

dotenv.config();

const app = new Hono();
app.use(sessionMiddleware);

// Configuration
// DOMAIN will be determined dynamically from request headers

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error('MONGODB_URI is not set in environment variables');
}

const client = new MongoClient(mongoUri);
export { client };

// Function to get domain from request context
function getDomainFromRequest(c: { req: { header: (name: string) => string | undefined } }): string {
  const host = c.req.header('host') || c.req.header('Host');
  if (host) {
    // Remove port if present (e.g., "localhost:3000" -> "localhost")
    return host.split(':')[0];
  }
  // Fallback for development
  return 'localhost';
}

// --- AttachHandlers global script injection ---
const attachHandlersScript = (domain: string) => `
window.attachHandlers = function() {
  const DOMAIN = '${domain}';
  
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

// Reply form functions
window.showReplyForm = function(postId) {
  const replyForm = document.getElementById('reply-form-' + postId);
  if (replyForm) {
    replyForm.style.display = 'block';
    const textarea = replyForm.querySelector('input[name="content"]');
    if (textarea) {
      textarea.focus();
    }
  }
};

window.hideReplyForm = function(postId) {
  const replyForm = document.getElementById('reply-form-' + postId);
  if (replyForm) {
    replyForm.style.display = 'none';
    const textarea = replyForm.querySelector('input[name="content"]');
    if (textarea) {
      textarea.value = '';
    }
  }
};

// Like and repost functions
window.toggleLike = async function(postId) {
  const button = document.querySelector('button[onclick="toggleLike(\\'' + postId + '\\')"]');
  if (!button) return;
  
  try {
    const response = await fetch('/post/' + postId + '/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      const icon = data.liked ? '❤️' : '🤍';
      button.innerHTML = icon + ' ' + (data.likeCount || 0);
    }
  } catch (error) {
    console.error('Error toggling like:', error);
  }
};

window.toggleRepost = async function(postId) {
  const button = document.querySelector('button[onclick="toggleRepost(\\'' + postId + '\\')"]');
  if (!button) return;
  
  try {
    const response = await fetch('/post/' + postId + '/repost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      const icon = data.reposted ? '🔄' : '⚪';
      button.innerHTML = icon + ' ' + (data.repostCount || 0);
    }
  } catch (error) {
    console.error('Error toggling repost:', error);
  }
};

// Remote follow form handler
window.handleRemoteFollow = async function(event) {
  event.preventDefault();
  
  const form = event.target;
  const formData = new FormData(form);
  const remoteUser = formData.get('remoteUser');
  const msgDiv = document.getElementById('remote-follow-msg');
  
  if (!remoteUser || !remoteUser.toString().includes('@')) {
    if (msgDiv) {
      msgDiv.innerHTML = '<small style="color: #c00;">Please enter a valid username@domain format</small>';
    }
    return;
  }
  
  try {
    const response = await fetch('/remote-follow', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      if (msgDiv) {
        msgDiv.innerHTML = '<small style="color: #090;">✅ ' + data.message + '</small>';
      }
      // Clear the form
      form.reset();
      // Reload the page to show new remote posts
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else {
      if (msgDiv) {
        msgDiv.innerHTML = '<small style="color: #c00;">❌ ' + data.error + '</small>';
      }
    }
  } catch (error) {
    console.error('Remote follow error:', error);
    if (msgDiv) {
      msgDiv.innerHTML = '<small style="color: #c00;">❌ Network error. Please try again.</small>';
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
  invalidPassword,
  domain
}: {
  user: User | null,
  postCount: number,
  followerCount: number,
  followingCount: number,
  allPosts: Post[],
  userMap: Map<string, User>,
  loggedIn: boolean,
  invalidPassword: boolean,
  domain: string
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
          border-radius: 8px;
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
      <script id="main-handlers-script" data-main-handlers="true" type="text/javascript">${attachHandlersScript(domain)}</script>
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
          <h1 id="profile-name"><a href="/" style="text-decoration: none; color: inherit;">${user?.name || 'fongoblog2'}</a></h1>
          <p id="profile-username"><a href="/@${user?.username || ''}" style="text-decoration: none; color: inherit;">@${user?.username || ''}@${domain}</a></p>
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
      
      <div class="remote-follow-card" style="margin-bottom: 2em; padding: 1.5em; border: 1px solid var(--muted-border-color); border-radius: 12px; background: var(--card-background-color, #fff); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
        <h3 style="margin-top: 0; margin-bottom: 0.5em; font-size: 1.1em;">🌐 Follow Remote User</h3>
        <p style="margin-bottom: 1em; color: var(--muted-color); font-size: 0.9em;">Follow someone from another ActivityPub server (e.g., username@mastodon.social)</p>
        <form method="post" action="/remote-follow" class="remote-follow-form" onsubmit="handleRemoteFollow(event)">

            <input name="remoteUser" placeholder="username@domain" required class="input" style="width: 100%; font-size: 0.9em;" />
            <small style="color: var(--muted-color); font-size: 0.8em;">Enter the full username including domain</small>

            <button type="submit" class="primary" style="padding: 0.5rem 1rem; font-size: 0.9em; white-space: nowrap;">Follow</button>
         
        </form>
        <div id="remote-follow-msg" style="margin-top: 0.5em;"></div>
      </div>
      ` : ''}
      <div class="timeline-container">
        <ul class="timeline-list">
          ${allPosts.map(post => {
            const postUser = userMap.get(post.userId.toString());
            const isRemote = (post as any).remote;
            const remoteDomain = isRemote ? post.userId.toString().split('@')[1] : null;
            
            return `
            <li class="card" ${isRemote ? 'style="border-left: 4px solid #007bff; background: #f8f9fa;"' : ''}>
              <header>
                <a href="${isRemote ? postUser?.bio?.includes('Remote user from') ? '#' : `/@${postUser?.username ?? 'unknown'}` : `/@${postUser?.username ?? 'unknown'}`}" class="post-author">
                  ${postUser?.name ?? 'Unknown'} 
                  <span style="color: var(--muted-color); font-weight: normal;">
                    (@${postUser?.username ?? 'unknown'}${isRemote ? `@${remoteDomain}` : `@${domain}`})
                  </span>
                  ${isRemote ? '<span style="color: #007bff; font-size: 0.8em; margin-left: 0.5em;">🌐 Remote</span>' : ''}
                </a>
              </header>
              <p>${post.content}</p>
              <footer class="post-meta">
                <div style="display: flex; align-items: center; gap: 1em;">
                  <button onclick="toggleLike('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                    🤍 ${(post as any).likeCount || 0}
                  </button>
                  <button onclick="toggleRepost('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                    ⚪ ${(post as any).repostCount || 0}
                  </button>
                  <button onclick="showReplyForm('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                    💬 ${(post as any).replyCount || 0}
                  </button>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5em; margin-top: 0.5em;">
                  <small>${post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ''}</small>
                  ${isRemote ? 
                    `<small style="color: #007bff;">🌐 From ${remoteDomain}</small>` : 
                    `<a href="/post/${post._id}" class="permalink-link">🔗 Permalink</a>`
                  }
                </div>
              </footer>
              ${loggedIn && !isRemote ? `
              <div id="reply-form-${post._id}" style="display: none; margin-top: 1em; padding-top: 1em; border-top: 1px solid var(--muted-border-color);">
                <form method="post" action="/reply" class="reply-form">
                  <input type="hidden" name="replyTo" value="${post._id}" />
                  <input name="content" placeholder="Write a reply..." required class="input" style="min-height: 60px; resize: vertical;" />
                  <div style="margin-top: 0.5em;">
                    <button type="submit" class="primary" style="margin-right: 0.5em;">Reply</button>
                    <button type="button" onclick="hideReplyForm('${post._id}')" class="outline">Cancel</button>
                  </div>
                </form>
              </div>
              ` : ''}
            </li>
          `}).join('')}
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
  followingCount,
  domain
}: {
  profileUser: User,
  currentUser: User | null,
  userPosts: Post[],
  userMap: Map<string, User>,
  loggedIn: boolean,
  isOwnProfile: boolean,
  isFollowing: boolean,
  postCount: number,
  followerCount: number,
  followingCount: number,
  domain: string
}) {
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>@${profileUser.username}@${domain} - fongoblog2</title>
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
          border-radius: 8px;
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
          const response = await fetch('/@${profileUser.username}/follow', {
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
      <article id="profile-card" class="card">
        <img id="header-img" src="${profileUser.headerUrl || ''}" alt="header" style="object-fit:cover;${profileUser.headerUrl ? '' : 'display:none;'}" />
        <img id="avatar-img" src="${profileUser.avatarUrl || ''}" alt="avatar" style="width:60px;height:60px;border-radius:50%;object-fit:cover;${profileUser.avatarUrl ? '' : 'display:none;'}" />
        <div class="profile-info">
          <h1 id="profile-name"><a href="/" style="text-decoration: none; color: inherit;">${profileUser.name}</a></h1>
          <p id="profile-username"><a href="/@${profileUser.username}" style="text-decoration: none; color: inherit;">@${profileUser.username}@${domain}</a></p>
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
                <a href="/@${userMap.get(post.userId.toString())?.username ?? 'unknown'}" class="post-author">${userMap.get(post.userId.toString())?.name ?? 'Unknown'} <span style="color: var(--muted-color); font-weight: normal;">(@${userMap.get(post.userId.toString())?.username ?? 'unknown'}@${domain})</span></a>
              </header>
              <p>${post.content}</p>
              <footer class="post-meta">
                <div style="display: flex; align-items: center; gap: 1em;">
                  <button onclick="toggleLike('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                    🤍 ${(post as any).likeCount || 0}
                  </button>
                  <button onclick="toggleRepost('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                    ⚪ ${(post as any).repostCount || 0}
                  </button>
                  <button onclick="showReplyForm('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                    💬 ${(post as any).replyCount || 0}
                  </button>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5em; margin-top: 0.5em;">
                  <small>${post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ''}</small>
                  <a href="/post/${post._id}" class="permalink-link">🔗 Permalink</a>
                </div>
              </footer>
              ${loggedIn ? `
              <div id="reply-form-${post._id}" style="display: none; margin-top: 1em; padding-top: 1em; border-top: 1px solid var(--muted-border-color);">
                <form method="post" action="/reply" class="reply-form">
                  <input type="hidden" name="replyTo" value="${post._id}" />
                  <input name="content" placeholder="Write a reply..." required class="input" style="min-height: 60px; resize: vertical;" />
                  <div style="margin-top: 0.5em;">
                    <button type="submit" class="primary" style="margin-right: 0.5em;">Reply</button>
                    <button type="button" onclick="hideReplyForm('${post._id}')" class="outline">Cancel</button>
                  </div>
                </form>
              </div>
              ` : ''}
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
  followingCount,
  domain
}: {
  post: Post,
  postAuthor: User,
  currentUser: User | null,
  userMap: Map<string, User>,
  loggedIn: boolean,
  postCount: number,
  followerCount: number,
  followingCount: number,
  domain: string
}) {
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>@${postAuthor.username}@${domain} - fongoblog2</title>
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
          border-radius: 8px;
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
      <article id="profile-card" class="card">
        <img id="header-img" src="${postAuthor.headerUrl || ''}" alt="header" style="object-fit:cover;${postAuthor.headerUrl ? '' : 'display:none;'}" />
        <img id="avatar-img" src="${postAuthor.avatarUrl || ''}" alt="avatar" style="width:60px;height:60px;border-radius:50%;object-fit:cover;${postAuthor.avatarUrl ? '' : 'display:none;'}" />
        <div class="profile-info">
          <h1 id="profile-name"><a href="/" style="text-decoration: none; color: inherit;">${postAuthor.name}</a></h1>
          <p id="profile-username"><a href="/@${postAuthor.username}" style="text-decoration: none; color: inherit;">@${postAuthor.username}@${domain}</a></p>
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
              <a href="/@${userMap.get(post.userId.toString())?.username ?? 'unknown'}" class="post-author">${userMap.get(post.userId.toString())?.name ?? 'Unknown'} <span style="color: var(--muted-color); font-weight: normal;">(@${userMap.get(post.userId.toString())?.username ?? 'unknown'}@${domain})</span></a>
            </header>
            <p>${post.content}</p>
            <footer class="post-meta">
              <div style="display: flex; align-items: center; gap: 1em;">
                <button onclick="toggleLike('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                  🤍 ${(post as any).likeCount || 0}
                </button>
                <button onclick="toggleRepost('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                  ⚪ ${(post as any).repostCount || 0}
                </button>
                <button onclick="showReplyForm('${post._id}')" class="secondary" style="padding: 0.25em 0.5em; font-size: 0.9em; border: none; background: none; cursor: pointer;">
                  💬 ${(post as any).replyCount || 0}
                </button>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5em; margin-top: 0.5em;">
                <small>${post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ''}</small>
                <a href="/post/${post._id}" class="permalink-link">🔗 Permalink</a>
              </div>
            </footer>
            ${loggedIn ? `
            <div id="reply-form-${post._id}" style="display: none; margin-top: 1em; padding-top: 1em; border-top: 1px solid var(--muted-border-color);">
              <form method="post" action="/reply" class="reply-form">
                <input type="hidden" name="replyTo" value="${post._id}" />
                <input name="content" placeholder="Write a reply..." required class="input" style="min-height: 60px; resize: vertical;" />
                <div style="margin-top: 0.5em;">
                  <button type="submit" class="primary" style="margin-right: 0.5em;">Reply</button>
                  <button type="button" onclick="hideReplyForm('${post._id}')" class="outline">Cancel</button>
                </div>
              </form>
            </div>
            ` : ''}
          </li>
        </ul>
      </div>
    </body>
    </html>
  `;
}

// @username route (direct profile page) - DEFINED BEFORE /user/:username
app.get('/@*', async (c) => {
  console.log('=== @USERNAME ROUTE HIT ===');
  console.log('Path:', c.req.path);
  console.log('URL:', c.req.url);
  console.log('Method:', c.req.method);
  
  const path = c.req.path;
  const username = path.substring(2); // Remove the /@ prefix
  console.log('Username from path:', username);
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  const follows = db.collection<Follow>('follows');
  
  // Check if any users exist, if not redirect to setup
  const anyUser = await users.findOne({});
  if (!anyUser) return c.redirect('/setup');
  
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
  const postCount = await posts.countDocuments({ userId: profileUser._id });
  const followerCount = await follows.countDocuments({ followingId: profileUser._id?.toString() });
  const followingCount = await follows.countDocuments({ followerId: profileUser._id?.toString() });
  
  // Create userMap for posts
  const userMap = new Map<string, User>();
  userMap.set(profileUser._id?.toString() || '', profileUser);
  
  console.log('Rendering @username profile page for:', username);
  const domain = getDomainFromRequest(c);
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
    followingCount,
    domain
  }));
});

// User profile page (/user/username) - SECOND ROUTE for fediverse compatibility
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
  const userMap = new Map<string, User>();
  userMap.set(profileUser._id?.toString() || '', profileUser);
  
  console.log('Rendering profile page for:', username);
  const domain = getDomainFromRequest(c);
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
    followingCount,
    domain
  }));
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
  const userMap = new Map<string, User>();
  userMap.set(post.userId.toString(), postAuthor);
  
  // Stats for the author
  const postCount = await posts.countDocuments({ userId: postAuthor._id });
  const followerCount = await follows.countDocuments({ followingId: postAuthor._id?.toString() });
  const followingCount = await follows.countDocuments({ followerId: postAuthor._id?.toString() });
  
  console.log('Rendering post permalink page for:', postId);
  const domain = getDomainFromRequest(c);
  return c.html(renderPostPermalink({ 
    post, 
    postAuthor, 
    currentUser, 
    userMap, 
    loggedIn, 
    postCount, 
    followerCount, 
    followingCount,
    domain
  }));
});

// Setup page (only if no user exists)
app.get('/setup', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const user = await users.findOne({});
  if (user) return c.redirect('/');
  const domain = getDomainFromRequest(c);
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
          padding: 2rem;
        }
        
        .setup-header {
          text-align: center;
          margin-bottom: 2rem;
        }
        
        .setup-form {
          background: var(--card-background-color);
          padding: 2rem;
          border-radius: 8px;
          border: 1px solid var(--muted-border-color);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="setup-header">
          <h1>Welcome to fongoblog2</h1>
          <p>This is (supposed to be) a federated single-user microblog on MongoDB Atlas. Let's get you set up.</p>
        </div>
        
        
        <form method="post" action="/setup" class="setup-form">
          
          <div>
            <label for="username">Username@${domain}</label>
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
  const { publicKey, privateKey } = generateRSAKeyPair();
  const newUser: User = { username, name, passwordHash, createdAt: new Date(), publicKey, privateKey };
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
  
  // Get local posts
  let allPosts = await posts.find({}).sort({ createdAt: -1 }).limit(20).toArray();
  
  // If logged in, also fetch remote posts from followed users
  if (loggedIn && user) {
    const remoteFollows = await follows.find({ 
      followerId: user._id?.toString(), 
      remote: true 
    }).toArray();
    
    // Fetch remote posts for each followed remote user
    for (const remoteFollow of remoteFollows) {
      try {
        if (remoteFollow.followingUrl) {
          // Get the outbox URL from the actor profile
          const actorResponse = await fetch(remoteFollow.followingUrl, {
            headers: {
              'Accept': 'application/activity+json'
            }
          });
          
          if (actorResponse.ok) {
            const actor = await actorResponse.json();
            const outboxUrl = actor.outbox;
            
            if (outboxUrl) {
              // Fetch recent posts from the outbox
              const outboxResponse = await fetch(outboxUrl, {
                headers: {
                  'Accept': 'application/activity+json'
                }
              });
              
              if (outboxResponse.ok) {
                const outbox = await outboxResponse.json();
                
                // Process Create activities that contain Note objects
                if (outbox.orderedItems) {
                  for (const activity of outbox.orderedItems.slice(0, 5)) { // Limit to 5 recent posts
                    if (activity.type === 'Create' && activity.object && activity.object.type === 'Note') {
                      const remotePost = {
                        _id: new ObjectId(), // Generate a local ID
                        userId: remoteFollow.followingId, // Use the remote user ID
                        content: activity.object.content || '',
                        createdAt: new Date(activity.published || activity.object.published || Date.now()),
                        updatedAt: new Date(activity.updated || activity.object.updated || Date.now()),
                        federated: true,
                        federatedFrom: activity.actor,
                        remote: true,
                        remotePostId: activity.object.id,
                        remoteActor: activity.actor
                      };
                      
                      allPosts.push(remotePost);
                    }
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching remote posts for ${remoteFollow.followingId}:`, error);
      }
    }
    
    // Sort all posts by creation date (newest first)
    allPosts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // Limit to 20 posts total
    allPosts = allPosts.slice(0, 20);
  }
  
  // Fetch usernames for posts
  const userMap = new Map<string, User>();
  for (const post of allPosts) {
    const userIdStr = post.userId.toString();
    if (post.userId && !userMap.has(userIdStr)) {
      // Check if this is a remote user
      if (post.remote) {
        // For remote users, create a virtual user object
        const remoteUsername = post.userId.toString();
        userMap.set(userIdStr, {
          _id: remoteUsername,
          username: remoteUsername.split('@')[0] || remoteUsername,
          name: remoteUsername.split('@')[0] || remoteUsername,
          bio: `Remote user from ${remoteUsername.split('@')[1] || 'unknown domain'}`,
          avatarUrl: '',
          headerUrl: '',
          passwordHash: '',
          createdAt: new Date()
        });
      } else {
        // Local user
        let user: User | null = null;
        try {
          // Handle both ObjectId and string types
          const userId = typeof post.userId === 'string' ? new ObjectId(post.userId) : post.userId;
          user = await users.findOne({ _id: userId });
        } catch (e) {
          // ignore invalid ObjectId
        }
        if (user) {
          userMap.set(userIdStr, user);
        }
      }
    }
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
  const domain = getDomainFromRequest(c);
  const html = renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn, invalidPassword: false, domain });
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
    const userMap = new Map<string, User>();
    for (const post of allPosts) {
      const userIdStr = post.userId.toString();
      if (post.userId && !userMap.has(userIdStr)) {
        let user: User | null = null;
        try {
          // Handle both ObjectId and string types
          const userId = typeof post.userId === 'string' ? new ObjectId(post.userId) : post.userId;
          user = await users.findOne({ _id: userId });
        } catch (e) {}
        if (user) {
          userMap.set(userIdStr, user);
        }
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
        const domain = getDomainFromRequest(c);
        return c.json({ success: false, html: renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: false, invalidPassword: true, domain }) });
      }
      console.log('Login failed, returning HTML response');
      const domain = getDomainFromRequest(c);
      return c.html(renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: false, invalidPassword: true, domain }));
    }
    if (user._id) {
      setSessionCookie(c, user._id.toString());
    }
    if (wantsJson) {
      console.log('Login successful, returning JSON response');
      const domain = getDomainFromRequest(c);
      return c.json({ success: true, html: renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: true, invalidPassword: false, domain }) });
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
  
  // Mark the post as federated
  const domain = getDomainFromRequest(c);
  await markPostAsFederated(result.insertedId.toString());
  
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
  
  const isCurrentlyFollowing = await isFollowing(currentUser.username || '', username);
  
  if (isCurrentlyFollowing) {
    // Unfollow
    await removeFollow(currentUser.username || '', username);
    return c.json({ success: true, following: false });
  }
  
  // Follow
  const domain = getDomainFromRequest(c);
  await createFollow(currentUser.username || '', username);
  return c.json({ success: true, following: true });
});

// Follow/Unfollow user via @username
app.post('/@:username/follow', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  
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
  
  const isCurrentlyFollowing = await isFollowing(currentUser.username || '', username);
  
  if (isCurrentlyFollowing) {
    // Unfollow
    await removeFollow(currentUser.username || '', username);
    return c.json({ success: true, following: false });
  }
  
  // Follow
  const domain = getDomainFromRequest(c);
  await createFollow(currentUser.username || '', username);
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
  const currentDomain = getDomainFromRequest(c);
  
  if (domain !== currentDomain) {
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
        href: `https://${currentDomain}/users/${username}`
      }
    ]
  });
});

// NodeInfo endpoint
app.get('/.well-known/nodeinfo', async (c) => {
  const currentDomain = getDomainFromRequest(c);
  return c.json({
    links: [
      {
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
        href: `https://${currentDomain}/.well-known/nodeinfo/2.0`
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
  const currentDomain = getDomainFromRequest(c);
  
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
    id: `https://${currentDomain}/users/${username}`,
    type: 'Person',
    preferredUsername: username,
    name: user.name,
    summary: user.bio || '',
    url: `https://${currentDomain}/@${username}`,
    icon: user.avatarUrl ? {
      type: 'Image',
      url: user.avatarUrl
    } : undefined,
    image: user.headerUrl ? {
      type: 'Image',
      url: user.headerUrl
    } : undefined,
    inbox: `https://${currentDomain}/users/${username}/inbox`,
    outbox: `https://${currentDomain}/users/${username}/outbox`,
    followers: `https://${currentDomain}/users/${username}/followers`,
    following: `https://${currentDomain}/users/${username}/following`,
    publicKey: {
      id: `https://${currentDomain}/users/${username}#main-key`,
      owner: `https://${currentDomain}/users/${username}`,
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----\n'
    },
    endpoints: {
      sharedInbox: `https://${currentDomain}/inbox`
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

// ActivityPub Outbox - serves user's public activities
app.get('/users/:username/outbox', async (c) => {
  const username = c.req.param('username');
  const currentDomain = getDomainFromRequest(c);
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  
  const user = await users.findOne({ username });
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Get user's posts
  const userPosts = await posts.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20).toArray();
  
  // Convert posts to ActivityPub Create activities
  const activities = userPosts.map(post => ({
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `https://${currentDomain}/users/${username}/statuses/${post._id}`,
    "type": "Create",
    "actor": `https://${currentDomain}/users/${username}`,
    "published": post.createdAt,
    "to": ["https://www.w3.org/ns/activitystreams#Public"],
    "cc": [`https://${currentDomain}/users/${username}/followers`],
    "object": {
      "@context": "https://www.w3.org/ns/activitystreams",
      "id": `https://${currentDomain}/users/${username}/statuses/${post._id}`,
      "type": "Note",
      "summary": null,
      "content": post.content,
      "inReplyTo": null,
      "published": post.createdAt,
      "url": `https://${currentDomain}/users/${username}/statuses/${post._id}`,
      "attributedTo": `https://${currentDomain}/users/${username}`,
      "to": ["https://www.w3.org/ns/activitystreams#Public"],
      "cc": [`https://${currentDomain}/users/${username}/followers`],
      "sensitive": false,
      "atomUri": `https://${currentDomain}/users/${username}/statuses/${post._id}`,
      "inReplyToAtomUri": null,
      "conversation": null,
      "replies": {
        "id": `https://${currentDomain}/users/${username}/statuses/${post._id}/replies`,
        "type": "Collection",
        "first": {
          "type": "CollectionPage",
          "next": `https://${currentDomain}/users/${username}/statuses/${post._id}/replies?only_activities=true&page=true`,
          "partOf": `https://${currentDomain}/users/${username}/statuses/${post._id}/replies`,
          "items": []
        }
      }
    }
  }));
  
  const outbox = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `https://${currentDomain}/users/${username}/outbox`,
    "type": "OrderedCollection",
    "totalItems": activities.length,
    "orderedItems": activities,
    "first": `https://${currentDomain}/users/${username}/outbox?page=true`,
    "last": `https://${currentDomain}/users/${username}/outbox?min_id=0&page=true`
  };
  
  return c.json(outbox);
});

// Individual post as ActivityPub Note
app.get('/users/:username/statuses/:postId', async (c) => {
  const username = c.req.param('username');
  const postId = c.req.param('postId');
  const currentDomain = getDomainFromRequest(c);
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  
  const user = await users.findOne({ username });
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  let post: Post | null = null;
  try {
    post = await posts.findOne({ _id: new ObjectId(postId), userId: user._id });
  } catch (e) {
    return c.json({ error: 'Invalid post ID' }, 400);
  }
  
  if (!post) {
    return c.json({ error: 'Post not found' }, 404);
  }
  
  const note = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `https://${currentDomain}/users/${username}/statuses/${post._id}`,
    "type": "Note",
    "summary": null,
    "content": post.content,
    "inReplyTo": null,
    "published": post.createdAt,
    "url": `https://${currentDomain}/users/${username}/statuses/${post._id}`,
    "attributedTo": `https://${currentDomain}/users/${username}`,
    "to": ["https://www.w3.org/ns/activitystreams#Public"],
    "cc": [`https://${currentDomain}/users/${username}/followers`],
    "sensitive": false,
    "atomUri": `https://${currentDomain}/users/${username}/statuses/${post._id}`,
    "inReplyToAtomUri": null,
    "conversation": null,
    "replies": {
      "id": `https://${currentDomain}/users/${username}/statuses/${post._id}/replies`,
      "type": "Collection",
      "first": {
        "type": "CollectionPage",
        "next": `https://${currentDomain}/users/${username}/statuses/${post._id}/replies?only_activities=true&page=true`,
        "partOf": `https://${currentDomain}/users/${username}/statuses/${post._id}/replies`,
        "items": []
      }
    },
    "reblogsCount": 0,
    "favouritesCount": 0,
    "favourited": false,
    "reblogged": false,
    "muted": false,
    "bookmarked": false,
    "pinned": false,
    "reblog": null,
    "application": {
      "name": "fongoblog2",
      "website": null
    },
    "media_attachments": [],
    "mentions": [],
    "tags": [],
    "emojis": [],
    "card": null,
    "poll": null
  };
  
  return c.json(note);
});

// ActivityPub Inbox - accepts incoming activities
app.post('/users/:username/inbox', async (c) => {
  const username = c.req.param('username');
  const currentDomain = getDomainFromRequest(c);
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  const user = await users.findOne({ username });
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  const body = await c.req.json();
  console.log('Inbox received activity:', JSON.stringify(body, null, 2));
  
  // Handle Follow activity
  if (body.type === 'Follow') {
    const follower = body.actor;
    const following = body.object;
    
    // Verify this is a follow request for our user
    if (following === `https://${currentDomain}/users/${username}`) {
      // Extract username from actor URL (simplified - in production you'd want to fetch the actor)
      const actorUrl = new URL(follower);
      const followerUsername = actorUrl.pathname.split('/').pop();
      
      if (followerUsername) {
        // Store the follow relationship
        await follows.insertOne({
          followerId: follower, // Store the full actor URL
          followingId: user._id?.toString() || '',
          createdAt: new Date()
        });
        
        console.log(`Follow request accepted from ${follower}`);
        
        // Send Accept activity back
        const acceptActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          "id": `https://${currentDomain}/follows/${Date.now()}`,
          "type": "Accept",
          "actor": `https://${currentDomain}/users/${username}`,
          "object": body
        };
        
        // In a real implementation, you'd send this back to the follower's inbox
        console.log('Would send Accept activity:', acceptActivity);
      }
    }
  }
  
  // Handle Undo Follow activity
  if (body.type === 'Undo' && body.object?.type === 'Follow') {
    const follower = body.actor;
    const following = body.object.object;
    
    if (following === `https://${currentDomain}/users/${username}`) {
      // Remove the follow relationship
      await follows.deleteOne({
        followerId: follower,
        followingId: user._id?.toString()
      });
      
      console.log(`Unfollow request processed from ${follower}`);
    }
  }
  
  return c.json({ success: true });
});

// Shared inbox for efficiency
app.post('/inbox', async (c) => {
  const body = await c.req.json();
  console.log('Shared inbox received activity:', JSON.stringify(body, null, 2));
  
  // For now, just log the activity
  // In a real implementation, you'd route it to the appropriate user's inbox
  return c.json({ success: true });
});

// Followers collection
app.get('/users/:username/followers', async (c) => {
  const username = c.req.param('username');
  const currentDomain = getDomainFromRequest(c);
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  const user = await users.findOne({ username });
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  const followers = await follows.find({ followingId: user._id?.toString() }).toArray();
  
  const collection = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `https://${currentDomain}/users/${username}/followers`,
    "type": "OrderedCollection",
    "totalItems": followers.length,
    "orderedItems": followers.map(f => f.followerId)
  };
  
  return c.json(collection);
});

// Following collection
app.get('/users/:username/following', async (c) => {
  const username = c.req.param('username');
  const currentDomain = getDomainFromRequest(c);
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  const user = await users.findOne({ username });
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  const following = await follows.find({ followerId: user._id?.toString() }).toArray();
  
  const collection = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `https://${currentDomain}/users/${username}/following`,
    "type": "OrderedCollection",
    "totalItems": following.length,
    "orderedItems": following.map(f => f.followingId)
  };
  
  return c.json(collection);
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

// --- Mount Fedify ActivityPub routes ---
mountFedifyRoutes(app, client);

// --- Start the server ---
serve({ fetch: app.fetch, port: 8000 });

// Reply to a post
app.post('/reply', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.redirect('/');
  }
  
  const loggedInUser = await users.findOne({ _id: new ObjectId(session) });
  if (!loggedInUser) {
    return c.redirect('/');
  }
  
  const body = await c.req.parseBody();
  const replyTo = typeof body['replyTo'] === 'string' ? body['replyTo'] : '';
  const content = typeof body['content'] === 'string' ? body['content'] : '';
  
  if (!replyTo || !content) {
    return c.redirect('/');
  }
  
  // Verify the post being replied to exists
  let parentPost: Post | null = null;
  try {
    parentPost = await posts.findOne({ _id: new ObjectId(replyTo) });
  } catch (e) {
    return c.redirect('/');
  }
  
  if (!parentPost) {
    return c.redirect('/');
  }
  
  // Create the reply post
  const replyPost: Post = {
    userId: loggedInUser._id,
    content,
    createdAt: new Date(),
    replyTo: new ObjectId(replyTo)
  };
  
  await posts.insertOne(replyPost);
  return c.redirect('/');
});

// Like a post
app.post('/post/:postId/like', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.json({ success: false, error: 'Not logged in' });
  }
  
  const loggedInUser = await users.findOne({ _id: new ObjectId(session) });
  if (!loggedInUser) {
    return c.json({ success: false, error: 'User not found' });
  }
  
  const postId = c.req.param('postId');
  let post: Post | null = null;
  try {
    post = await posts.findOne({ _id: new ObjectId(postId) });
  } catch (e) {
    return c.json({ success: false, error: 'Invalid post ID' });
  }
  
  if (!post) {
    return c.json({ success: false, error: 'Post not found' });
  }
  
  // For now, just increment the like count
  // In a real implementation, you'd track individual likes
  const currentLikeCount = (post as any).likeCount || 0;
  await posts.updateOne(
    { _id: new ObjectId(postId) },
    { $set: { likeCount: currentLikeCount + 1 } }
  );
  
  return c.json({ 
    success: true, 
    liked: true, 
    likeCount: currentLikeCount + 1 
  });
});

// Repost a post
app.post('/post/:postId/repost', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.json({ success: false, error: 'Not logged in' });
  }
  
  const loggedInUser = await users.findOne({ _id: new ObjectId(session) });
  if (!loggedInUser) {
    return c.json({ success: false, error: 'User not found' });
  }
  
  const postId = c.req.param('postId');
  let post: Post | null = null;
  try {
    post = await posts.findOne({ _id: new ObjectId(postId) });
  } catch (e) {
    return c.json({ success: false, error: 'Invalid post ID' });
  }
  
  if (!post) {
    return c.json({ success: false, error: 'Post not found' });
  }
  
  // For now, just increment the repost count
  // In a real implementation, you'd track individual reposts
  const currentRepostCount = (post as any).repostCount || 0;
  await posts.updateOne(
    { _id: new ObjectId(postId) },
    { $set: { repostCount: currentRepostCount + 1 } }
  );
  
  return c.json({ 
    success: true, 
    reposted: true, 
    repostCount: currentRepostCount + 1 
  });
});

// Federation dashboard
app.get('/federation', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.redirect('/');
  }
  
  const loggedInUser = await users.findOne({ _id: new ObjectId(session) });
  if (!loggedInUser) {
    return c.redirect('/');
  }
  
  const domain = getDomainFromRequest(c);
  const stats = await getFederationStats();
  const recentActivity = await getRecentFederationActivity(10);
  const federatedPosts = await getFederatedPosts(20, 0);
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Federation Dashboard - fongoblog2</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-number { font-size: 2em; font-weight: bold; color: #1a73e8; }
        .stat-label { color: #666; margin-top: 5px; }
        .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .section h2 { margin-top: 0; color: #333; }
        .post { border-bottom: 1px solid #eee; padding: 15px 0; }
        .post:last-child { border-bottom: none; }
        .post-meta { color: #666; font-size: 0.9em; margin-bottom: 5px; }
        .post-content { margin: 10px 0; }
        .nav { margin-bottom: 20px; }
        .nav a { color: #1a73e8; text-decoration: none; }
        .nav a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="nav">
          <a href="/">← Back to Home</a>
        </div>
        
        <div class="header">
          <h1>🌐 Federation Dashboard</h1>
          <p>Monitor your ActivityPub federation activity and statistics.</p>
        </div>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-number">${stats.totalUsers}</div>
            <div class="stat-label">Total Users</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${stats.totalPosts}</div>
            <div class="stat-label">Total Posts</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${stats.federatedPosts}</div>
            <div class="stat-label">Federated Posts</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${stats.totalFollows}</div>
            <div class="stat-label">Follow Relationships</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${stats.federationPercentage.toFixed(1)}%</div>
            <div class="stat-label">Federation Rate</div>
          </div>
        </div>
        
        <div class="section">
          <h2>📊 Recent Federation Activity</h2>
          <div class="post">
            <div class="post-meta">
              <strong>Federated Posts:</strong> ${recentActivity.recentPosts.length} recent posts
            </div>
          </div>
          <div class="post">
            <div class="post-meta">
              <strong>Follow Activity:</strong> ${recentActivity.recentFollows.length} recent follows
            </div>
          </div>
        </div>
        
        <div class="section">
          <h2>📝 Recent Federated Posts</h2>
          ${federatedPosts.map(post => `
            <div class="post">
              <div class="post-meta">
                <strong>@${post.user?.username || 'unknown'}</strong> • 
                ${new Date(post.createdAt).toLocaleString()} • 
                ${post.federatedFrom ? `Federated from: ${post.federatedFrom}` : 'Local post'}
              </div>
              <div class="post-content">${post.content}</div>
            </div>
          `).join('')}
        </div>
        
        <div class="section">
          <h2>🔗 ActivityPub Endpoints</h2>
          <p><strong>NodeInfo:</strong> <a href="/.well-known/nodeinfo" target="_blank">/.well-known/nodeinfo</a></p>
          <p><strong>NodeInfo 2.0:</strong> <a href="/.well-known/nodeinfo/2.0" target="_blank">/.well-known/nodeinfo/2.0</a></p>
          <p><strong>WebFinger:</strong> <a href="/.well-known/webfinger?resource=acct:${loggedInUser.username}@${domain}" target="_blank">/.well-known/webfinger</a></p>
          <p><strong>User Actor:</strong> <a href="/users/${loggedInUser.username}" target="_blank">/users/${loggedInUser.username}</a></p>
          <p><strong>User Outbox:</strong> <a href="/users/${loggedInUser.username}/outbox" target="_blank">/users/${loggedInUser.username}/outbox</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return c.html(html);
});

// Remote follow handler
app.post('/remote-follow', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.json({ success: false, error: 'Not logged in' });
  }
  
  const currentUser = await users.findOne({ _id: new ObjectId(session) });
  if (!currentUser) {
    return c.json({ success: false, error: 'User not found' });
  }
  
  const body = await c.req.parseBody();
  const remoteUser = typeof body['remoteUser'] === 'string' ? body['remoteUser'] : '';
  
  if (!remoteUser || !remoteUser.includes('@')) {
    return c.json({ success: false, error: 'Invalid remote user format. Use username@domain' });
  }
  
  const [username, domain] = remoteUser.split('@');
  if (!username || !domain) {
    return c.json({ success: false, error: 'Invalid remote user format. Use username@domain' });
  }
  
  try {
    // First, try to discover the remote user via WebFinger
    const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;
    const webfingerResponse = await fetch(webfingerUrl);
    
    if (!webfingerResponse.ok) {
      return c.json({ success: false, error: `Could not find user ${remoteUser} on ${domain}` });
    }
    
    const webfinger = await webfingerResponse.json();
    
    // Find the actor URL from WebFinger links
    const actorLink = webfinger.links?.find((link: any) => 
      link.rel === 'self' && link.type === 'application/activity+json'
    );
    
    if (!actorLink?.href) {
      return c.json({ success: false, error: `Could not find actor URL for ${remoteUser}` });
    }
    
    const actorUrl = actorLink.href;
    
    // Get the actor profile to find their inbox
    const actorResponse = await fetch(actorUrl, {
      headers: {
        'Accept': 'application/activity+json'
      }
    });
    
    if (!actorResponse.ok) {
      return c.json({ success: false, error: `Could not fetch profile for ${remoteUser}` });
    }
    
    const actor = await actorResponse.json();
    const inboxUrl = actor.inbox;
    
    if (!inboxUrl) {
      return c.json({ success: false, error: `Could not find inbox for ${remoteUser}` });
    }
    
    // Create and send the Follow activity
    const followActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Follow",
      "actor": `https://${getDomainFromRequest(c)}/users/${currentUser.username}`,
      "object": actorUrl,
      "to": [actorUrl],
      "cc": ["https://www.w3.org/ns/activitystreams#Public"]
    };
    
    // Send the Follow activity to the remote user's inbox
    const followResponse = await fetch(inboxUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/activity+json',
        'Accept': 'application/activity+json'
      },
      body: JSON.stringify(followActivity)
    });
    
    if (followResponse.ok) {
      // Store the remote follow relationship in our database
      const follows = db.collection('follows');
      await follows.insertOne({
        followerId: currentUser._id?.toString(),
        followingId: `${username}@${domain}`,
        followingUrl: actorUrl,
        followingInbox: inboxUrl,
        remote: true,
        createdAt: new Date()
      });
      
      return c.json({ 
        success: true, 
        message: `Successfully sent follow request to ${remoteUser}`,
        actorUrl,
        inboxUrl
      });
    } else {
      return c.json({ 
        success: false, 
        error: `Failed to send follow request to ${remoteUser}. Status: ${followResponse.status}` 
      });
    }
    
  } catch (error) {
    console.error('Error following remote user:', error);
    return c.json({ 
      success: false, 
      error: `Error following ${remoteUser}: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
});