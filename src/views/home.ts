import type { User, Post } from '../models';

export function renderHome({
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
      <title>fongoblog2</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <style>
        :root { color-scheme: light; }
        
        .container {
          max-width: 800px;
          margin: 0 auto;
          padding: 1rem;
        }
        
        .post {
          margin: 1em 0;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .post-header {
          display: flex;
          align-items: center;
          gap: 1em;
          margin-bottom: 1em;
        }
        
        .avatar {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          object-fit: cover;
        }
        
        .user-info {
          flex: 1;
        }
        
        .username {
          font-weight: bold;
          font-size: 1.1em;
          margin: 0;
        }
        
        .display-name {
          color: var(--muted-color);
          margin: 0;
        }
        
        .post-content {
          margin: 1em 0;
          line-height: 1.6;
        }
        
        .post-meta {
          color: var(--muted-color);
          font-size: 0.9em;
          margin-top: 1em;
        }
        
        .profile-card {
          margin: 1em 0;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .profile-stats {
          display: flex;
          gap: 2em;
          margin: 1em 0;
        }
        
        .stat-item {
          text-align: center;
        }
        
        .stat-number {
          display: block;
          font-size: 1.5em;
          font-weight: bold;
          color: var(--primary);
        }
        
        .login-form {
          margin: 2em 0;
          padding: 2em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
        }
        
        .remote-follow-form {
          margin: 1em 0;
          padding: 1em;
          border: 1px solid var(--muted-border-color);
          border-radius: 8px;
          background: var(--card-background-color, #fff);
        }
        
        .remote-badge {
          background: #17a2b8;
          color: white;
          padding: 0.2em 0.5em;
          border-radius: 4px;
          font-size: 0.8em;
          margin-left: 0.5em;
        }
        
        .federation-dashboard {
          margin: 2em 0;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
        }
        
        .federation-status {
          display: inline-block;
          padding: 0.3em 0.6em;
          border-radius: 4px;
          font-size: 0.9em;
          font-weight: bold;
        }
        
        .status-healthy {
          background: #d4edda;
          color: #155724;
        }
        
        .status-error {
          background: #f8d7da;
          color: #721c24;
        }
      </style>
    </head>
    <body>
      <main class="container">
        <header>
          <h1>fongoblog2</h1>
          <p>A federated microblogging platform</p>
        </header>
        
        ${user ? `
          <div class="profile-card">
            <div class="post-header">
              <img src="${user.avatarUrl || 'https://placehold.co/100x100'}" alt="Avatar" class="avatar">
              <div class="user-info">
                <h3 class="username">${user.name}</h3>
                <p class="display-name">@${user.username}</p>
              </div>
            </div>
            
            <div class="profile-stats">
              <div class="stat-item">
                <span class="stat-number" id="stat-posts">${postCount}</span> Posts
              </div>
              <div class="stat-item">
                <span class="stat-number" id="stat-followers">${followerCount}</span> Followers
              </div>
              <div class="stat-item">
                <a href="/following" style="text-decoration: none; color: inherit;">
                  <span class="stat-number" id="stat-following">${followingCount}</span> Following
                </a>
              </div>
            </div>
            
            <form method="POST" action="/post" id="post-form">
              <textarea name="content" placeholder="What's happening?" required></textarea>
              <button type="submit">Post</button>
            </form>
            
            <div class="remote-follow-form">
              <h4>Follow Remote User</h4>
              <p>Follow users from other ActivityPub servers (e.g., Mastodon, Misskey)</p>
              <form method="POST" action="/remote-follow" id="remote-follow-form">
                <input type="text" name="remoteUser" placeholder="username@domain.com" required>
                <button type="submit">Follow</button>
              </form>
            </div>
            
            <div class="federation-dashboard">
              <h4>Federation Status</h4>
              <p>
                <span class="federation-status status-healthy">✅ Healthy</span>
                Your profile is federated and discoverable by other ActivityPub servers.
              </p>
              <p><strong>Your Profile URL:</strong> <a href="https://${domain}/users/${user.username}" target="_blank">https://${domain}/users/${user.username}</a></p>
              <p><strong>WebFinger:</strong> <a href="https://${domain}/.well-known/webfinger?resource=acct:${user.username}@${domain}" target="_blank">acct:${user.username}@${domain}</a></p>
              <p><strong>NodeInfo:</strong> <a href="https://${domain}/.well-known/nodeinfo/2.0" target="_blank">https://${domain}/.well-known/nodeinfo/2.0</a></p>
            </div>
            
            <form method="POST" action="/logout" style="margin-top: 1em;">
              <button type="submit" class="outline">Logout</button>
            </form>
          </div>
        ` : `
          <div class="login-form">
            <h2>Login</h2>
            ${invalidPassword ? '<p style="color: red;">Invalid password</p>' : ''}
            <form method="POST" action="/login">
              <label for="username">Username</label>
              <input type="text" id="username" name="username" required>
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required>
              <button type="submit">Login</button>
            </form>
          </div>
        `}
        
        <div id="posts">
          ${allPosts.map(post => {
            const postUser = userMap.get(post.userId.toString());
            if (!postUser) return '';
            
            const isRemote = post.remote || false;
            const postDate = new Date(post.createdAt).toLocaleString();
            
            return `
              <article class="post">
                <div class="post-header">
                  <img src="${postUser.avatarUrl || 'https://placehold.co/100x100'}" alt="Avatar" class="avatar">
                  <div class="user-info">
                    <h3 class="username">
                      ${postUser.name}
                      ${isRemote ? '<span class="remote-badge">Remote</span>' : ''}
                    </h3>
                    <p class="display-name">@${postUser.username}</p>
                  </div>
                </div>
                <div class="post-content">${post.content}</div>
                <div class="post-meta">
                  <a href="/posts/${post._id}" style="color: inherit; text-decoration: none;">
                    ${postDate}
                  </a>
                  ${isRemote ? ` • From ${post.federatedFrom || 'remote server'}` : ''}
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </main>
      
      <script>
        // Auto-submit post form
        document.getElementById('post-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const form = e.target;
          const formData = new FormData(form);
          
          try {
            const response = await fetch('/post', {
              method: 'POST',
              body: formData
            });
            
            const result = await response.json();
            if (result.success) {
              form.reset();
              location.reload();
            } else {
              alert('Error: ' + result.error);
            }
          } catch (error) {
            alert('Error posting');
          }
        });
        
        // Auto-submit remote follow form
        document.getElementById('remote-follow-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const form = e.target;
          const formData = new FormData(form);
          
          try {
            const response = await fetch('/remote-follow', {
              method: 'POST',
              body: formData
            });
            
            const result = await response.json();
            if (result.success) {
              form.reset();
              alert('Successfully followed remote user!');
            } else {
              alert('Error: ' + result.error);
            }
          } catch (error) {
            alert('Error following remote user');
          }
        });
      </script>
    </body>
    </html>
  `;
}

export function renderUserProfile({
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
      <title>${profileUser.name} (@${profileUser.username}) - fongoblog2</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <style>
        :root { color-scheme: light; }
        
        .container {
          max-width: 800px;
          margin: 0 auto;
          padding: 1rem;
        }
        
        .profile-header {
          margin: 1em 0;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .profile-info {
          display: flex;
          align-items: center;
          gap: 1em;
          margin-bottom: 1em;
        }
        
        .avatar {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          object-fit: cover;
        }
        
        .user-details {
          flex: 1;
        }
        
        .username {
          font-weight: bold;
          font-size: 1.5em;
          margin: 0;
        }
        
        .display-name {
          color: var(--muted-color);
          margin: 0;
        }
        
        .profile-stats {
          display: flex;
          gap: 2em;
          margin: 1em 0;
        }
        
        .stat-item {
          text-align: center;
        }
        
        .stat-number {
          display: block;
          font-size: 1.5em;
          font-weight: bold;
          color: var(--primary);
        }
        
        .post {
          margin: 1em 0;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .post-content {
          margin: 1em 0;
          line-height: 1.6;
        }
        
        .post-meta {
          color: var(--muted-color);
          font-size: 0.9em;
          margin-top: 1em;
        }
        
        .follow-btn {
          background: var(--primary);
          color: white;
          border: none;
          padding: 0.5em 1em;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1em;
        }
        
        .unfollow-btn {
          background: #dc3545;
          color: white;
          border: none;
          padding: 0.5em 1em;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1em;
        }
        
        .follow-btn:hover {
          background: var(--primary-hover);
        }
        
        .unfollow-btn:hover {
          background: #c82333;
        }
      </style>
    </head>
    <body>
      <main class="container">
        <nav>
          <a href="/" role="button">← Back to Home</a>
        </nav>
        
        <div class="profile-header">
          <div class="profile-info">
            <img src="${profileUser.avatarUrl || 'https://placehold.co/100x100'}" alt="Avatar" class="avatar">
            <div class="user-details">
              <h2 class="username">${profileUser.name}</h2>
              <p class="display-name">@${profileUser.username}</p>
              ${profileUser.bio ? `<p>${profileUser.bio}</p>` : ''}
            </div>
            ${!isOwnProfile && loggedIn ? `
              <button class="${isFollowing ? 'unfollow-btn' : 'follow-btn'}" 
                      onclick="${isFollowing ? 'unfollowUser' : 'followUser'}('${profileUser._id}')">
                ${isFollowing ? 'Unfollow' : 'Follow'}
              </button>
            ` : ''}
          </div>
          
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
        </div>
        
        <div id="posts">
          ${userPosts.map(post => {
            const postDate = new Date(post.createdAt).toLocaleString();
            return `
              <article class="post">
                <div class="post-content">${post.content}</div>
                <div class="post-meta">
                  <a href="/posts/${post._id}" style="color: inherit; text-decoration: none;">
                    ${postDate}
                  </a>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </main>
      
      <script>
        async function followUser(userId) {
          try {
            const response = await fetch('/follow', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId })
            });
            
            const result = await response.json();
            if (result.success) {
              location.reload();
            } else {
              alert('Error: ' + result.error);
            }
          } catch (error) {
            alert('Error following user');
          }
        }
        
        async function unfollowUser(userId) {
          if (!confirm('Are you sure you want to unfollow this user?')) return;
          
          try {
            const response = await fetch('/unfollow', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId })
            });
            
            const result = await response.json();
            if (result.success) {
              location.reload();
            } else {
              alert('Error: ' + result.error);
            }
          } catch (error) {
            alert('Error unfollowing user');
          }
        }
      </script>
    </body>
    </html>
  `;
}

export function renderPostPermalink({
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
  const postDate = new Date(post.createdAt).toLocaleString();
  const isRemote = post.remote || false;
  
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Post by ${postAuthor.name} - fongoblog2</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <style>
        :root { color-scheme: light; }
        
        .container {
          max-width: 800px;
          margin: 0 auto;
          padding: 1rem;
        }
        
        .post {
          margin: 1em 0;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .post-header {
          display: flex;
          align-items: center;
          gap: 1em;
          margin-bottom: 1em;
        }
        
        .avatar {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          object-fit: cover;
        }
        
        .user-info {
          flex: 1;
        }
        
        .username {
          font-weight: bold;
          font-size: 1.1em;
          margin: 0;
        }
        
        .display-name {
          color: var(--muted-color);
          margin: 0;
        }
        
        .post-content {
          margin: 1em 0;
          line-height: 1.6;
          font-size: 1.1em;
        }
        
        .post-meta {
          color: var(--muted-color);
          font-size: 0.9em;
          margin-top: 1em;
        }
        
        .remote-badge {
          background: #17a2b8;
          color: white;
          padding: 0.2em 0.5em;
          border-radius: 4px;
          font-size: 0.8em;
          margin-left: 0.5em;
        }
      </style>
    </head>
    <body>
      <main class="container">
        <nav>
          <a href="/" role="button">← Back to Home</a>
        </nav>
        
        <article class="post">
          <div class="post-header">
            <img src="${postAuthor.avatarUrl || 'https://placehold.co/100x100'}" alt="Avatar" class="avatar">
            <div class="user-info">
              <h3 class="username">
                ${postAuthor.name}
                ${isRemote ? '<span class="remote-badge">Remote</span>' : ''}
              </h3>
              <p class="display-name">@${postAuthor.username}</p>
            </div>
          </div>
          <div class="post-content">${post.content}</div>
          <div class="post-meta">
            ${postDate}
            ${isRemote ? ` • From ${post.federatedFrom || 'remote server'}` : ''}
          </div>
        </article>
      </main>
    </body>
    </html>
  `;
} 