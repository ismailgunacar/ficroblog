import type { User, Post } from '../models';

interface ProfileViewProps {
  profileUser: User;
  currentUser: User | null;
  userPosts: Post[];
  userMap: Map<string, User>;
  loggedIn: boolean;
  isOwnProfile: boolean;
  isFollowing: boolean;
  postCount: number;
  followerCount: number;
  followingCount: number;
  domain: string;
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
}: ProfileViewProps): string {
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>@${profileUser.username}@${domain} - fongoblog2</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <link rel="stylesheet" href="/styles/main.css">
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
      ${renderProfileHeader({ profileUser, postCount, followerCount, followingCount, domain })}
      
      ${loggedIn && !isOwnProfile ? `
        <div style="text-align: center; margin: 1em 0;">
          <button id="follow-btn" class="${isFollowing ? 'outline' : 'primary'}" onclick="toggleFollow()">
            ${isFollowing ? 'Unfollow' : 'Follow'}
          </button>
        </div>
      ` : ''}
      
      <div class="back-link">
        <a href="/" class="secondary">← Back to Home</a>
      </div>
      
      ${renderUserTimeline({ posts: userPosts, userMap, domain })}
    </body>
    </html>
  `;
}

function renderProfileHeader({ profileUser, postCount, followerCount, followingCount, domain }: {
  profileUser: User;
  postCount: number;
  followerCount: number;
  followingCount: number;
  domain: string;
}): string {
  return `
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
  `;
}

function renderUserTimeline({ posts, userMap, domain }: {
  posts: Post[];
  userMap: Map<string, User>;
  domain: string;
}): string {
  return `
    <div class="timeline-container">
      <ul class="timeline-list">
        ${posts.map(post => renderUserPost({ post, userMap, domain })).join('')}
      </ul>
    </div>
  `;
}

function renderUserPost({ post, userMap, domain }: {
  post: Post;
  userMap: Map<string, User>;
  domain: string;
}): string {
  const postUser = userMap.get(post.userId.toString());
  
  return `
    <li class="card">
      <header>
        <a href="/@${postUser?.username ?? 'unknown'}" class="post-author">
          ${postUser?.name ?? 'Unknown'} 
          <span style="color: var(--muted-color); font-weight: normal;">
            (@${postUser?.username ?? 'unknown'}@${domain})
          </span>
        </a>
      </header>
      <p>${post.content}</p>
      <footer class="post-meta">
        <div style="display: flex; align-items: center; gap: 0.5em;">
          <small>${post.createdAt ? new Date(post.createdAt).toLocaleDateString() : ''}</small>
          <a href="/post/${post._id}" class="permalink-link">🔗 Permalink</a>
        </div>
      </footer>
    </li>
  `;
}