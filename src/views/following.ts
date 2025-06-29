import type { User } from '../models';

export function renderFollowingList({
  currentUser,
  localFollows,
  remoteFollows,
  localUsers,
  domain
}: {
  currentUser: User,
  localFollows: any[],
  remoteFollows: any[],
  localUsers: User[],
  domain: string
}) {
  return `
    <!DOCTYPE html>
    <html lang="en" data-theme="light">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Following - fongoblog2</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      <style>
        :root { color-scheme: light; }
        
        .container {
          max-width: 800px;
          margin: 0 auto;
          padding: 1rem;
        }
        
        .following-card {
          margin: 1em 0;
          padding: 1.5em;
          border: 1px solid var(--muted-border-color);
          border-radius: 12px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .user-info {
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
        
        .user-details {
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
        
        .unfollow-btn {
          background: #dc3545;
          color: white;
          border: none;
          padding: 0.5em 1em;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.9em;
        }
        
        .unfollow-btn:hover {
          background: #c82333;
        }
        
        .remote-badge {
          background: #17a2b8;
          color: white;
          padding: 0.2em 0.5em;
          border-radius: 4px;
          font-size: 0.8em;
          margin-left: 0.5em;
        }
        
        .section-title {
          margin: 2em 0 1em 0;
          padding-bottom: 0.5em;
          border-bottom: 2px solid var(--muted-border-color);
        }
        
        .empty-state {
          text-align: center;
          padding: 2em;
          color: var(--muted-color);
        }
      </style>
    </head>
    <body>
      <main class="container">
        <header>
          <h1>Following</h1>
          <p>Users you're following</p>
        </header>
        
        <div class="user-info">
          <img src="${currentUser.avatarUrl || 'https://placehold.co/100x100'}" alt="Avatar" class="avatar">
          <div class="user-details">
            <h3 class="username">${currentUser.name}</h3>
            <p class="display-name">@${currentUser.username}</p>
          </div>
        </div>
        
        <nav>
          <a href="/" role="button">← Back to Home</a>
        </nav>
        
        ${localFollows.length > 0 ? `
          <h2 class="section-title">Local Users</h2>
          ${localFollows.map(follow => {
            const user = localUsers.find(u => u._id.toString() === follow.followingId);
            if (!user) return '';
            return `
              <div class="following-card" data-user-id="${user._id}">
                <div class="user-info">
                  <img src="${user.avatarUrl || 'https://placehold.co/100x100'}" alt="Avatar" class="avatar">
                  <div class="user-details">
                    <h3 class="username">${user.name}</h3>
                    <p class="display-name">@${user.username}</p>
                  </div>
                  <button class="unfollow-btn" onclick="unfollowLocal('${user._id}')">Unfollow</button>
                </div>
              </div>
            `;
          }).join('')}
        ` : ''}
        
        ${remoteFollows.length > 0 ? `
          <h2 class="section-title">Remote Users</h2>
          ${remoteFollows.map(follow => `
            <div class="following-card" data-remote-user="${follow.followingId}">
              <div class="user-info">
                <img src="https://placehold.co/100x100" alt="Avatar" class="avatar">
                <div class="user-details">
                  <h3 class="username">${follow.followingId.split('@')[0]}</h3>
                  <p class="display-name">@${follow.followingId} <span class="remote-badge">Remote</span></p>
                </div>
                <button class="unfollow-btn" onclick="unfollowRemote('${follow.followingId}')">Unfollow</button>
              </div>
            </div>
          `).join('')}
        ` : ''}
        
        ${localFollows.length === 0 && remoteFollows.length === 0 ? `
          <div class="empty-state">
            <h3>Not following anyone yet</h3>
            <p>Start following users to see their posts in your timeline!</p>
          </div>
        ` : ''}
      </main>
      
      <script>
        async function unfollowLocal(userId) {
          if (!confirm('Are you sure you want to unfollow this user?')) return;
          
          try {
            const response = await fetch('/unfollow', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId })
            });
            
            const result = await response.json();
            if (result.success) {
              document.querySelector(\`[data-user-id="\${userId}"]\`).remove();
            } else {
              alert('Error: ' + result.error);
            }
          } catch (error) {
            alert('Error unfollowing user');
          }
        }
        
        async function unfollowRemote(remoteUser) {
          if (!confirm('Are you sure you want to unfollow this user?')) return;
          
          try {
            const response = await fetch('/remote-unfollow', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ remoteUser })
            });
            
            const result = await response.json();
            if (result.success) {
              document.querySelector(\`[data-remote-user="\${remoteUser}"]\`).remove();
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