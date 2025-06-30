import type { User, Post } from '../models';

interface HomeViewProps {
  user: User | null;
  postCount: number;
  followerCount: number;
  followingCount: number;
  allPosts: Post[];
  userMap: Map<string, User>;
  loggedIn: boolean;
  invalidPassword: boolean;
  domain: string;
}

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
}: HomeViewProps): string {
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${user ? user.name : 'fongoblog2'}</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <link rel="stylesheet" href="/styles/main.css">
      <script type="module" src="/client/handlers.js"></script>
      <script>
        // Initialize handlers when DOM is ready
        document.addEventListener('DOMContentLoaded', function() {
          if (typeof window.attachHandlers === 'function') {
            window.attachHandlers('${domain}');
          }
        });
      </script>
    </head>
    <body class="container">
      ${renderProfileCard({ user, postCount, followerCount, followingCount, loggedIn, invalidPassword, domain })}
      
      ${loggedIn ? `
        ${renderPostForm()}
        ${renderRemoteFollowCard()}
      ` : ''}
      
      ${renderTimeline({ posts: allPosts, userMap, loggedIn, domain })}
    </body>
    </html>
  `;
}

function renderProfileCard({ user, postCount, followerCount, followingCount, loggedIn, invalidPassword, domain }: {
  user: User | null;
  postCount: number;
  followerCount: number;
  followingCount: number;
  loggedIn: boolean;
  invalidPassword: boolean;
  domain: string;
}): string {
  return `
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
  `;
}

function renderPostForm(): string {
  return `
    <form method="post" action="/" class="post-form">
      <input name="content" placeholder="What's on your mind?" required class="input" />
      <button type="submit" class="primary">Post</button>
    </form>
  `;
}

function renderRemoteFollowCard(): string {
  return `
    <div class="remote-follow-card">
      <h3 style="margin-top: 0; margin-bottom: 0.5em; font-size: 1.1em;">🌐 Follow Remote User</h3>
      <p style="margin-bottom: 1em; color: var(--muted-color); font-size: 0.9em;">Follow someone from another ActivityPub server (e.g., username@mastodon.social)</p>
      <form method="post" action="/remote-follow" class="remote-follow-form" onsubmit="handleRemoteFollow(event)">
        <input name="remoteUser" placeholder="@username@domain" required class="input" style="width: 100%; font-size: 0.9em;" />
        <small style="color: var(--muted-color); font-size: 0.8em;">Enter the full username including domain</small>
        <button type="submit" class="primary" style="padding: 0.5rem 1rem; font-size: 0.9em; white-space: nowrap;">Follow</button>
      </form>
      <div id="remote-follow-msg" style="margin-top: 0.5em;"></div>
    </div>
  `;
}

function renderTimeline({ posts, userMap, loggedIn, domain }: {
  posts: Post[];
  userMap: Map<string, User>;
  loggedIn: boolean;
  domain: string;
}): string {
  return `
    <div class="timeline-container">
      <ul class="timeline-list">
        ${posts.map(post => renderPost({ post, userMap, loggedIn, domain })).join('')}
      </ul>
    </div>
  `;
}

function renderPost({ post, userMap, loggedIn, domain }: {
  post: Post;
  userMap: Map<string, User>;
  loggedIn: boolean;
  domain: string;
}): string {
  const postUser = userMap.get(post.userId.toString());
  const isRemote = (post as any).remote;
  const remoteDomain = isRemote ? post.userId.toString().split('@')[1] : null;
  
  return `
    <li class="card" ${isRemote ? 'data-remote="true"' : ''}>
      <header>
        <a href="${isRemote ? postUser?.bio?.includes('Remote user from') ? '#' : `/@${postUser?.username ?? 'unknown'}` : `/@${postUser?.username ?? 'unknown'}`}" class="post-author">
          ${postUser?.name ?? 'Unknown'} 
          <span style="color: var(--muted-color); font-weight: normal;">
            (@${postUser?.username ?? 'unknown'}${isRemote ? `@${remoteDomain}` : `@${domain}`})
          </span>
          ${isRemote ? '<span class="remote-indicator">🌐 Remote</span>' : ''}
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
  `;
}